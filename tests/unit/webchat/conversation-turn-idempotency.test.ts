import { describe, expect, it, vi } from "vitest";

import type { ConversationStore } from "@/modules/conversations/conversation-store";
import type { AuditInput, PersistedConversation, PersistedOrganization } from "@/modules/conversations/persistence.types";
import type { AiOperationalStore, AiPublicResponse, AiReservationInput, AiReservationResult } from "@/modules/webchat/ai-operational-store";
import { ReservedAiUsageBudgetGate, ConversationTurnOrchestrator } from "@/modules/webchat/conversation-turn-orchestrator";
import { ConversationTurnService } from "@/modules/webchat/conversation-turn-service";
import type { NaturalLanguageIntentClient } from "@/modules/webchat/openai-responses-intent-client";
import { OpenAITransportError } from "@/modules/webchat/openai-responses-intent-client";
import { ApplicationError } from "@/shared/errors/application-error";
import { hashSessionToken } from "@/shared/auth/session-token";

const now = new Date("2026-08-06T10:00:00Z");
const token = "opaque-token";
const sessionSecret = "session-secret-with-at-least-thirty-two-characters";
const conversation: PersistedConversation = {
  id: "internal-conversation", organizationId: "internal-organization", organizationExternalRef: "external",
  organizationTimeZone: "UTC", publicReference: "conv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", state: "STARTED",
  debtorRef: null, verifiedDebtorContext: null, identityStatus: "NOT_STARTED", failedIdentityAttempts: 0,
  identityLockedAt: null, startedAt: now, lastActivityAt: now, endedAt: null, optedOutAt: null, messages: [],
};

class Store implements ConversationStore {
  audits: AuditInput[] = [];
  async findActiveOrganizationBySlug(): Promise<PersistedOrganization | null> { return null; }
  async createConversation(): Promise<PersistedConversation> { throw new Error("unused"); }
  async authenticateConversation(ref: string, hash: string) { return ref === conversation.publicReference && hash === hashSessionToken(token, sessionSecret) ? conversation : null; }
  async recordIdentification(): Promise<PersistedConversation> { throw new Error("unused"); }
  async recordIdentityAttempt(): Promise<PersistedConversation> { throw new Error("unused"); }
  async recordAudit(input: { audit: AuditInput }) { this.audits.push(input.audit); }
  async recordTerminalState(): Promise<PersistedConversation> { throw new Error("unused"); }
}

class MemoryAiStore implements AiOperationalStore {
  records = new Map<string, { fingerprint: string; status: "RESERVED" | "DONE"; response?: AiPublicResponse }>();
  reserveCount = 0;
  completeCount = 0;
  lastComplete?: Parameters<AiOperationalStore["complete"]>[0];
  consumedCostMicrousd = BigInt(0);
  mode?: "BUDGET_EXHAUSTED" | "CIRCUIT_OPEN";
  async reserve(input: AiReservationInput): Promise<AiReservationResult> {
    const key = `${input.organizationId}:${input.conversationKeyHash}:${input.clientTurnKeyHash}`;
    const existing = this.records.get(key);
    if (existing) {
      if (existing.fingerprint !== input.requestFingerprint) throw new ApplicationError("AI_TURN_CONFLICT", "conflict", 409);
      return existing.status === "DONE" ? { kind: "REPLAY", response: existing.response! } : { kind: "IN_PROGRESS" };
    }
    if (this.mode) return { kind: this.mode };
    if (this.consumedCostMicrousd + input.reservedCostMicrousd > input.dailyLimitMicrousd) {
      return { kind: "BUDGET_EXHAUSTED" };
    }
    this.reserveCount += 1;
    this.records.set(key, { fingerprint: input.requestFingerprint, status: "RESERVED" });
    return { kind: "RESERVED", executionId: key };
  }
  async complete(input: Parameters<AiOperationalStore["complete"]>[0]) {
    this.completeCount += 1;
    this.lastComplete = input;
    this.consumedCostMicrousd += input.actualCostMicrousd;
    const record = this.records.get(input.executionId)!;
    await new Promise((resolve) => setTimeout(resolve, 20));
    this.records.set(input.executionId, { ...record, status: "DONE", response: input.response });
  }
  async finalizeWithoutCall(input: Parameters<AiOperationalStore["finalizeWithoutCall"]>[0]) {
    const key = `${input.reservation.organizationId}:${input.reservation.conversationKeyHash}:${input.reservation.clientTurnKeyHash}`;
    this.records.set(key, { fingerprint: input.reservation.requestFingerprint, status: "DONE", response: input.response });
    return input.response;
  }
}

function service(aiStore: MemoryAiStore, interpret: NaturalLanguageIntentClient["interpret"], dailyBudgetUsd = 0.5) {
  return new ConversationTurnService(
    new Store(),
    new ConversationTurnOrchestrator({ interpret }, new ReservedAiUsageBudgetGate(), { enabled: true, model: "gpt-5.6-luna" }),
    sessionSecret, 3_600, () => now, aiStore,
    {
      enabled: true, model: "gpt-5.6-luna", safetyHmacSecret: "h".repeat(64), maxInputTokens: 4_000,
      maxOutputTokens: 300, maxCallsPerConversation: 5, dailyBudgetUsd, monthlyBudgetUsd: 5,
      circuitFailureThreshold: 5, circuitOpenSeconds: 60,
      reservationTtlMs: 10_000,
    },
  );
}

const input = {
  publicReference: conversation.publicReference, token, message: "preciso de ajuda",
  clientTurnId: "00000000-0000-4000-8000-000000000099", uiContext: "IDENTITY" as const,
};

describe("AI turn idempotency and operational fallback", () => {
  it("makes exactly one model call for concurrent identical turns and replays the result", async () => {
    const aiStore = new MemoryAiStore();
    const interpret = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
      return { output: { intent: "HELP" as const, confidence: "HIGH" as const, explanationSegments: [{ type: "TEXT" as const, text: "Posso orientar com segurança.", factKey: null }], suggestedActions: ["HELP" as const] }, usage: { inputTokens: 20, outputTokens: 5 } };
    });
    const target = service(aiStore, interpret);
    const [first, second] = await Promise.all([target.interpret(input), target.interpret(input)]);
    expect(first).toEqual(second);
    expect(interpret).toHaveBeenCalledOnce();
    expect(aiStore.reserveCount).toBe(1);
    expect(aiStore.completeCount).toBe(1);
  });

  it("rejects a different payload with the same client turn id", async () => {
    const aiStore = new MemoryAiStore();
    const interpret = vi.fn(async () => ({ output: { intent: "HELP" as const, confidence: "HIGH" as const, explanationSegments: [{ type: "TEXT" as const, text: "Ajuda segura.", factKey: null }], suggestedActions: [] }, usage: { inputTokens: 1, outputTokens: 1 } }));
    const target = service(aiStore, interpret);
    await target.interpret(input);
    await expect(target.interpret({ ...input, message: "outro conteúdo" })).rejects.toMatchObject({ code: "AI_TURN_CONFLICT" });
    expect(interpret).toHaveBeenCalledOnce();
  });

  it("uses the complete 11A fallback without a model call when budget or circuit blocks", async () => {
    for (const mode of ["BUDGET_EXHAUSTED", "CIRCUIT_OPEN"] as const) {
      const aiStore = new MemoryAiStore();
      aiStore.mode = mode;
      const interpret = vi.fn();
      const result = await service(aiStore, interpret).interpret(input);
      expect(result.fallbackUsed).toBe(true);
      expect(interpret).not.toHaveBeenCalled();
      aiStore.mode = undefined;
      expect(await service(aiStore, interpret).interpret(input)).toEqual(result);
      expect(interpret).not.toHaveBeenCalled();
    }
  });

  it("records authentication failure for immediate circuit opening and replays its fallback", async () => {
    const aiStore = new MemoryAiStore();
    const interpret = vi.fn(async () => { throw new OpenAITransportError("AUTHENTICATION"); });
    const target = service(aiStore, interpret);
    const first = await target.interpret(input);
    const second = await target.interpret(input);
    expect(second).toEqual(first);
    expect(interpret).toHaveBeenCalledOnce();
    expect(aiStore.lastComplete?.failureCategory).toBe("AUTHENTICATION");
  });

  it("conservatively consumes the full reservation for an ambiguous post-send timeout", async () => {
    const aiStore = new MemoryAiStore();
    const interpret = vi.fn(async () => { throw new OpenAITransportError("UNKNOWN_OUTCOME"); });
    const result = await service(aiStore, interpret).interpret(input);
    expect(result.fallbackUsed).toBe(true);
    expect(aiStore.lastComplete?.failureCategory).toBe("UNKNOWN_OUTCOME");
    expect(aiStore.lastComplete?.actualCostMicrousd).toBeGreaterThan(BigInt(0));
    expect(aiStore.lastComplete?.actualCostMicrousd).toBe(aiStore.consumedCostMicrousd);
  });

  it("releases the reservation for a conclusive HTTP or local pre-transport failure", async () => {
    for (const category of ["INVALID_REQUEST", "TIMEOUT"] as const) {
      const aiStore = new MemoryAiStore();
      const interpret = vi.fn(async () => { throw new OpenAITransportError(category); });
      await service(aiStore, interpret).interpret({ ...input, clientTurnId: crypto.randomUUID() });
      expect(aiStore.lastComplete?.failureCategory).toBe(category);
      expect(aiStore.lastComplete?.actualCostMicrousd).toBe(BigInt(0));
    }
  });

  it("prevents successive ambiguous timeouts from bypassing the daily budget", async () => {
    const aiStore = new MemoryAiStore();
    const interpret = vi.fn(async () => { throw new OpenAITransportError("UNKNOWN_OUTCOME"); });
    const target = service(aiStore, interpret, 0.01);
    await target.interpret({ ...input, clientTurnId: "00000000-0000-4000-8000-000000000201" });
    const firstCharge = aiStore.consumedCostMicrousd;
    const second = await target.interpret({ ...input, clientTurnId: "00000000-0000-4000-8000-000000000202" });
    expect(second.fallbackUsed).toBe(true);
    expect(aiStore.consumedCostMicrousd).toBe(firstCharge);
    expect(interpret).toHaveBeenCalledOnce();
    expect(firstCharge).toBeGreaterThan(BigInt(0));
  });
});
