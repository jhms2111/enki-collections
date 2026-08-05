import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { ApplicationError } from "@/shared/errors/application-error";

import type {
  AiOperationalStore,
  AiPublicResponse,
  AiReservationInput,
  AiReservationResult,
} from "./ai-operational-store";
import { conversationTurnPublicResponseSchema } from "./conversation-turn.schemas";

function periodStart(now: Date, type: "DAILY" | "MONTHLY"): Date {
  return type === "DAILY"
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

class BudgetUnavailableError extends Error {}

export function shouldOpenAiCircuit(
  category: string,
  consecutiveFailures: number,
  threshold: number,
): boolean {
  return category === "AUTHENTICATION" || category === "QUOTA" || consecutiveFailures >= threshold;
}

export class PrismaAiOperationalStore implements AiOperationalStore {
  constructor(private readonly client: PrismaClient) {}

  async reserve(input: AiReservationInput): Promise<AiReservationResult> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.reserveOnce(input);
      } catch (error) {
        if (error instanceof BudgetUnavailableError) return { kind: "BUDGET_EXHAUSTED" };
        if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) {
          const existing = await this.findExisting(input);
          if (existing) return existing;
          if (attempt < 2) continue;
        }
        throw error;
      }
    }
    return { kind: "IN_PROGRESS" };
  }

  async complete(input: Parameters<AiOperationalStore["complete"]>[0]): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const execution = await tx.aiTurnExecution.findFirstOrThrow({
        where: { id: input.executionId, organizationId: input.organizationId },
        select: { status: true, reservedCostMicrousd: true, createdAt: true },
      });
      if (execution.status !== "RESERVED") return;

      const actual = input.actualCostMicrousd;
      const released = execution.reservedCostMicrousd - actual;
      for (const type of ["DAILY", "MONTHLY"] as const) {
        await tx.aiBudgetPeriod.update({
          where: {
            organizationId_periodType_periodStart: {
              organizationId: input.organizationId,
              periodType: type,
              periodStart: periodStart(execution.createdAt, type),
            },
          },
          data: {
            allocatedCostMicrousd: { decrement: released },
            reservedCostMicrousd: { decrement: execution.reservedCostMicrousd },
            consumedCostMicrousd: { increment: actual },
          },
        });
      }

      await tx.aiTurnExecution.update({
        where: { id: input.executionId },
        data: {
          status: input.failureCategory ? "FALLBACK" : "SUCCEEDED",
          actualCostMicrousd: actual,
          inputTokens: input.inputTokens,
          outputTokens: input.outputTokens,
          model: input.model,
          publicResponse: input.response as Prisma.InputJsonValue,
          failureCategory: input.failureCategory,
          completedAt: input.now,
        },
      });

      if (!input.failureCategory) {
        await tx.aiCircuitBreaker.update({
          where: { organizationId: input.organizationId },
          data: { state: "CLOSED", consecutiveFailures: 0, openUntil: null, halfOpenProbeInFlight: false, lastFailureCategory: null },
        });
      } else if (["RATE_LIMIT", "TIMEOUT", "SERVER_ERROR", "NETWORK", "AUTHENTICATION", "QUOTA"].includes(input.failureCategory)) {
        const circuit = await tx.aiCircuitBreaker.update({
          where: { organizationId: input.organizationId },
          data: { consecutiveFailures: { increment: 1 }, lastFailureCategory: input.failureCategory, halfOpenProbeInFlight: false },
          select: { consecutiveFailures: true },
        });
        if (shouldOpenAiCircuit(input.failureCategory, circuit.consecutiveFailures, input.circuitFailureThreshold)) {
          await tx.aiCircuitBreaker.update({
            where: { organizationId: input.organizationId },
            data: { state: "OPEN", openUntil: new Date(input.now.getTime() + input.circuitOpenSeconds * 1_000) },
          });
        }
      }
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  async finalizeWithoutCall(input: Parameters<AiOperationalStore["finalizeWithoutCall"]>[0]): Promise<AiPublicResponse> {
    const record = await this.client.aiTurnExecution.upsert({
      where: { organizationId_conversationKeyHash_clientTurnKeyHash: {
        organizationId: input.reservation.organizationId,
        conversationKeyHash: input.reservation.conversationKeyHash,
        clientTurnKeyHash: input.reservation.clientTurnKeyHash,
      } },
      create: {
        organizationId: input.reservation.organizationId,
        conversationKeyHash: input.reservation.conversationKeyHash,
        clientTurnKeyHash: input.reservation.clientTurnKeyHash,
        requestFingerprint: input.reservation.requestFingerprint,
        status: "FALLBACK",
        reservedCostMicrousd: BigInt(0),
        actualCostMicrousd: BigInt(0),
        inputTokens: 0,
        outputTokens: 0,
        publicResponse: input.response as Prisma.InputJsonValue,
        failureCategory: input.reason,
        reservedUntil: input.reservation.reservedUntil,
        completedAt: input.now,
      },
      update: {},
      select: { requestFingerprint: true, status: true, publicResponse: true },
    });
    const mapped = this.mapExisting(record, input.reservation.requestFingerprint);
    if (mapped.kind !== "REPLAY") throw new ApplicationError("AI_TURN_IN_PROGRESS", "Este turno ainda está sendo processado.", 409);
    return mapped.response;
  }

  private async reserveOnce(input: AiReservationInput): Promise<AiReservationResult> {
    return this.client.$transaction(async (tx) => {
      const existing = await tx.aiTurnExecution.findUnique({
        where: { organizationId_conversationKeyHash_clientTurnKeyHash: {
          organizationId: input.organizationId,
          conversationKeyHash: input.conversationKeyHash,
          clientTurnKeyHash: input.clientTurnKeyHash,
        } },
        select: { id: true, requestFingerprint: true, status: true, publicResponse: true, reservedUntil: true, reservedCostMicrousd: true, createdAt: true },
      });
      if (existing) {
        if (existing.requestFingerprint !== input.requestFingerprint) {
          throw new ApplicationError("AI_TURN_CONFLICT", "Este turno já foi usado com outro conteúdo.", 409);
        }
        if (existing.status === "RESERVED" && existing.reservedUntil <= input.now) {
          for (const type of ["DAILY", "MONTHLY"] as const) {
            await tx.aiBudgetPeriod.update({
              where: { organizationId_periodType_periodStart: {
                organizationId: input.organizationId,
                periodType: type,
                periodStart: periodStart(existing.createdAt, type),
              } },
              data: {
                allocatedCostMicrousd: { decrement: existing.reservedCostMicrousd },
                reservedCostMicrousd: { decrement: existing.reservedCostMicrousd },
              },
            });
          }
          const reconciled = await tx.aiTurnExecution.update({
            where: { id: existing.id },
            data: {
              status: "FALLBACK",
              actualCostMicrousd: BigInt(0),
              inputTokens: 0,
              outputTokens: 0,
              failureCategory: "STALE_RESERVATION",
              completedAt: input.now,
            },
            select: { requestFingerprint: true, status: true, publicResponse: true },
          });
          return this.mapExisting(reconciled, input.requestFingerprint);
        }
        return this.mapExisting(existing, input.requestFingerprint);
      }

      const callCount = await tx.aiTurnExecution.count({
        where: { organizationId: input.organizationId, conversationKeyHash: input.conversationKeyHash, reservedCostMicrousd: { gt: BigInt(0) } },
      });
      if (callCount >= input.maxCallsPerConversation) return { kind: "CONVERSATION_LIMIT" };

      const circuit = await tx.aiCircuitBreaker.upsert({
        where: { organizationId: input.organizationId },
        create: { organizationId: input.organizationId },
        update: {},
      });
      if (circuit.state === "OPEN" && circuit.openUntil && circuit.openUntil > input.now) {
        return { kind: "CIRCUIT_OPEN" };
      }
      if (circuit.state === "OPEN" || circuit.state === "HALF_OPEN") {
        const probe = await tx.aiCircuitBreaker.updateMany({
          where: { organizationId: input.organizationId, halfOpenProbeInFlight: false },
          data: { state: "HALF_OPEN", halfOpenProbeInFlight: true },
        });
        if (probe.count !== 1) return { kind: "CIRCUIT_OPEN" };
      }

      for (const [type, limit] of [["DAILY", input.dailyLimitMicrousd], ["MONTHLY", input.monthlyLimitMicrousd]] as const) {
        const start = periodStart(input.now, type);
        await tx.aiBudgetPeriod.upsert({
          where: { organizationId_periodType_periodStart: { organizationId: input.organizationId, periodType: type, periodStart: start } },
          create: { organizationId: input.organizationId, periodType: type, periodStart: start },
          update: {},
        });
        const availableCeiling = limit - input.reservedCostMicrousd;
        if (availableCeiling < BigInt(0)) throw new BudgetUnavailableError();
        const reserved = await tx.aiBudgetPeriod.updateMany({
          where: {
            organizationId: input.organizationId,
            periodType: type,
            periodStart: start,
            allocatedCostMicrousd: { lte: availableCeiling },
          },
          data: {
            allocatedCostMicrousd: { increment: input.reservedCostMicrousd },
            reservedCostMicrousd: { increment: input.reservedCostMicrousd },
            requestCount: { increment: 1 },
          },
        });
        if (reserved.count !== 1) throw new BudgetUnavailableError();
      }

      const execution = await tx.aiTurnExecution.create({
        data: {
          organizationId: input.organizationId,
          conversationKeyHash: input.conversationKeyHash,
          clientTurnKeyHash: input.clientTurnKeyHash,
          requestFingerprint: input.requestFingerprint,
          reservedCostMicrousd: input.reservedCostMicrousd,
          reservedUntil: input.reservedUntil,
          publicResponse: input.fallbackResponse as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      return { kind: "RESERVED", executionId: execution.id };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  }

  private async findExisting(input: AiReservationInput): Promise<AiReservationResult | null> {
    const existing = await this.client.aiTurnExecution.findUnique({
      where: { organizationId_conversationKeyHash_clientTurnKeyHash: {
        organizationId: input.organizationId,
        conversationKeyHash: input.conversationKeyHash,
        clientTurnKeyHash: input.clientTurnKeyHash,
      } },
      select: { requestFingerprint: true, status: true, publicResponse: true },
    });
    return existing ? this.mapExisting(existing, input.requestFingerprint) : null;
  }

  private mapExisting(
    existing: { requestFingerprint: string; status: string; publicResponse: unknown },
    fingerprint: string,
  ): AiReservationResult {
    if (existing.requestFingerprint !== fingerprint) {
      throw new ApplicationError("AI_TURN_CONFLICT", "Este turno já foi usado com outro conteúdo.", 409);
    }
    if (existing.status === "RESERVED") return { kind: "IN_PROGRESS" };
    return { kind: "REPLAY", response: conversationTurnPublicResponseSchema.parse(existing.publicResponse) as AiPublicResponse };
  }
}
