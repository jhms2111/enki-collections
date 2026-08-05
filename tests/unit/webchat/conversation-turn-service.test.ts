import { describe, expect, it, vi } from "vitest";

import type { ConversationStore } from "@/modules/conversations/conversation-store";
import type {
  AuditInput,
  PersistedConversation,
  PersistedOrganization,
} from "@/modules/conversations/persistence.types";
import {
  ClosedAiUsageBudgetGate,
  ConversationTurnOrchestrator,
} from "@/modules/webchat/conversation-turn-orchestrator";
import { ConversationTurnService } from "@/modules/webchat/conversation-turn-service";
import type { NaturalLanguageIntentClient } from "@/modules/webchat/openai-responses-intent-client";
import { hashSessionToken } from "@/shared/auth/session-token";

const now = new Date("2026-08-05T20:00:00.000Z");
const token = "opaque-session-token";
const secret = "conversation-turn-test-secret-with-at-least-32-characters";
const conversation: PersistedConversation = {
  id: "internal-conversation",
  organizationId: "org-demo",
  organizationExternalRef: "external-demo",
  organizationTimeZone: "America/Sao_Paulo",
  publicReference: "conv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  state: "STARTED",
  debtorRef: null,
  verifiedDebtorContext: null,
  identityStatus: "NOT_STARTED",
  failedIdentityAttempts: 0,
  identityLockedAt: null,
  startedAt: now,
  lastActivityAt: now,
  endedAt: null,
  optedOutAt: null,
  messages: [],
};

class TurnStore implements ConversationStore {
  audits: AuditInput[] = [];
  async findActiveOrganizationBySlug(): Promise<PersistedOrganization | null> { return null; }
  async createConversation(): Promise<PersistedConversation> { throw new Error("unused"); }
  async authenticateConversation(reference: string, tokenHash: string) {
    return reference === conversation.publicReference && tokenHash === hashSessionToken(token, secret)
      ? conversation
      : null;
  }
  async recordIdentification(): Promise<PersistedConversation> { throw new Error("unused"); }
  async recordIdentityAttempt(): Promise<PersistedConversation> { throw new Error("unused"); }
  async recordAudit(input: { audit: AuditInput }) { this.audits.push(input.audit); }
  async recordTerminalState(): Promise<PersistedConversation> { throw new Error("unused"); }
}

describe("ConversationTurnService", () => {
  it("requires the matching opaque conversation cookie", async () => {
    const store = new TurnStore();
    const client: NaturalLanguageIntentClient = { interpret: vi.fn() };
    const service = new ConversationTurnService(
      store,
      new ConversationTurnOrchestrator(client, new ClosedAiUsageBudgetGate(), {
        enabled: false,
        model: "gpt-5.6-luna",
      }),
      secret,
      3_600,
      () => now,
    );
    await expect(service.interpret({
      publicReference: conversation.publicReference,
      token: undefined,
      message: "ajuda",
      clientTurnId: "00000000-0000-4000-8000-000000000013",
      uiContext: "IDENTITY",
    })).rejects.toMatchObject({ code: "SESSION_REQUIRED" });
    await expect(service.interpret({
      publicReference: conversation.publicReference,
      token: "wrong-token",
      message: "ajuda",
      clientTurnId: "00000000-0000-4000-8000-000000000013",
      uiContext: "IDENTITY",
    })).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("audits only safe metadata and never raw conversational content", async () => {
    const store = new TurnStore();
    const interpret = vi.fn();
    const service = new ConversationTurnService(
      store,
      new ConversationTurnOrchestrator({ interpret }, new ClosedAiUsageBudgetGate(), {
        enabled: false,
        model: "gpt-5.6-luna",
      }),
      secret,
      3_600,
      () => now,
    );
    const sensitiveMessage = "texto privado que não deve ir para auditoria";
    const turnId = "00000000-0000-4000-8000-000000000014";
    const result = await service.interpret({
      publicReference: conversation.publicReference,
      token,
      message: sensitiveMessage,
      clientTurnId: turnId,
      uiContext: "IDENTITY",
    });
    expect(result.fallbackUsed).toBe(true);
    expect(interpret).not.toHaveBeenCalled();
    const serializedAudit = JSON.stringify(store.audits);
    expect(serializedAudit).not.toContain(sensitiveMessage);
    expect(serializedAudit).not.toContain(turnId);
    expect(store.audits[0].metadata).toMatchObject({
      fallbackUsed: true,
      clientTurnTracked: true,
    });
  });
});
