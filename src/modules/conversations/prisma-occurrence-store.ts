import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ApplicationError } from "@/shared/errors/application-error";

import type { IdempotencyScope } from "./acceptance-store";
import { parseAuditMetadata } from "./audit-metadata";
import type {
  OccurrenceRecord,
  OccurrenceResponse,
  OccurrenceStore,
} from "./occurrence-store";
import {
  disputeResponseSchema,
  paymentPromiseResponseSchema,
  paymentReportResponseSchema,
} from "./occurrence.schemas";
import type { PersistedConversation } from "./persistence.types";

export class PrismaOccurrenceStore implements OccurrenceStore {
  constructor(private readonly client: PrismaClient) {}

  async findResult(scope: IdempotencyScope) {
    const record = await this.client.idempotencyRecord.findUnique({
      where: {
        organizationId_operation_resourceRef_idempotencyKeyHash: {
          organizationId: scope.organizationId,
          operation: scope.operation,
          resourceRef: scope.resourceRef,
          idempotencyKeyHash: scope.keyHash,
        },
      },
      select: { requestFingerprint: true, responsePayload: true },
    });
    if (!record) return null;
    if (record.requestFingerprint !== scope.requestFingerprint) {
      throw new ApplicationError(
        "IDEMPOTENCY_CONFLICT",
        "A chave de idempotência já foi usada com outro conteúdo.",
        409,
      );
    }
    return this.parseResponse(scope, record.responsePayload);
  }

  async finalize(input: {
    scope: IdempotencyScope;
    conversation: PersistedConversation;
    occurrence: OccurrenceRecord;
    response: OccurrenceResponse;
    audit: Parameters<OccurrenceStore["finalize"]>[0]["audit"];
  }): Promise<OccurrenceResponse> {
    try {
      return await this.client.$transaction(async (tx) => {
        const existing = await tx.idempotencyRecord.findUnique({
          where: {
            organizationId_operation_resourceRef_idempotencyKeyHash: {
              organizationId: input.scope.organizationId,
              operation: input.scope.operation,
              resourceRef: input.scope.resourceRef,
              idempotencyKeyHash: input.scope.keyHash,
            },
          },
          select: { requestFingerprint: true, responsePayload: true },
        });
        if (existing) {
          if (existing.requestFingerprint !== input.scope.requestFingerprint) {
            throw new ApplicationError(
              "IDEMPOTENCY_CONFLICT",
              "A chave de idempotência já foi usada com outro conteúdo.",
              409,
            );
          }
          return this.parseResponse(input.scope, existing.responsePayload);
        }

        await this.createOccurrence(tx, input);
        await tx.idempotencyRecord.create({
          data: {
            organizationId: input.scope.organizationId,
            operation: input.scope.operation,
            resourceRef: input.scope.resourceRef,
            idempotencyKeyHash: input.scope.keyHash,
            requestFingerprint: input.scope.requestFingerprint,
            responsePayload: input.response as unknown as Prisma.InputJsonValue,
          },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: input.conversation.organizationId,
            conversationId: input.conversation.id,
            eventType: input.audit.eventType,
            actor: input.audit.actor,
            entityType: input.audit.entityType,
            entityRef: input.audit.entityRef,
            metadata: parseAuditMetadata(input.audit.metadata),
            occurredAt: input.audit.occurredAt,
          },
        });
        await tx.conversation.update({
          where: {
            id_organizationId: {
              id: input.conversation.id,
              organizationId: input.conversation.organizationId,
            },
          },
          data: { lastActivityAt: input.audit.occurredAt },
        });
        return input.response;
      }, { isolationLevel: "Serializable" });
    } catch (error) {
      const recovered = await this.findResult(input.scope);
      if (recovered) return recovered;
      throw error;
    }
  }

  private async createOccurrence(
    tx: Prisma.TransactionClient,
    input: Parameters<OccurrenceStore["finalize"]>[0],
  ) {
    const common = {
      id: input.occurrence.id,
      organizationId: input.conversation.organizationId,
      conversationId: input.conversation.id,
      publicReference: input.occurrence.publicReference,
      providerReference: input.occurrence.providerReference,
      debtRef: input.occurrence.debtRef,
      idempotencyKeyHash: input.scope.keyHash,
      status: input.occurrence.status,
    };
    if (input.occurrence.kind === "PAYMENT_PROMISE") {
      await tx.paymentPromise.create({
        data: {
          ...common,
          offerRef: input.occurrence.offerRef,
          promisedDate: input.occurrence.promisedDate,
          timeZone: input.occurrence.timeZone,
        },
      });
    } else if (input.occurrence.kind === "PAYMENT_REPORT") {
      await tx.paymentReport.create({
        data: {
          ...common,
          reportedAt: input.occurrence.reportedAt,
          receivedAt: input.occurrence.receivedAt,
        },
      });
    } else {
      await tx.dispute.create({
        data: {
          ...common,
          reasonCode: input.occurrence.reasonCode,
          description: input.occurrence.description,
        },
      });
    }
  }

  private parseResponse(
    scope: IdempotencyScope,
    payload: Prisma.JsonValue,
  ): OccurrenceResponse {
    if (scope.operation === "REGISTER_PAYMENT_PROMISE") {
      return paymentPromiseResponseSchema.parse(payload);
    }
    if (scope.operation === "REPORT_PAYMENT") {
      return paymentReportResponseSchema.parse(payload);
    }
    return disputeResponseSchema.parse(payload);
  }
}
