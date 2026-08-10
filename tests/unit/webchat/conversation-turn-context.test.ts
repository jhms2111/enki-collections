import { describe, expect, it, vi } from "vitest";

import type { ConversationStore } from "@/modules/conversations/conversation-store";
import type { AuditInput, PersistedConversation, PersistedOrganization } from "@/modules/conversations/persistence.types";
import type { DebtProvider } from "@/modules/debt-provider/debt-provider";
import type { AiOperationalStore } from "@/modules/webchat/ai-operational-store";
import { ReservedAiUsageBudgetGate, ConversationTurnOrchestrator } from "@/modules/webchat/conversation-turn-orchestrator";
import { ConversationTurnService } from "@/modules/webchat/conversation-turn-service";
import type { CanonicalFact, NormalizedInboundTurn } from "@/modules/webchat/conversation-turn.types";
import type { NaturalLanguageIntentClient } from "@/modules/webchat/openai-responses-intent-client";
import { ApplicationError } from "@/shared/errors/application-error";
import { hashSessionToken } from "@/shared/auth/session-token";

const now = new Date("2026-08-11T10:00:00.000Z");
const token = "opaque-context-session";
const sessionSecret = "context-session-secret-with-at-least-thirty-two-characters";
const verifiedContext = {
  verificationRef: "verification-opaque",
  authorizedAccounts: [{ debtorRef: "debtor-opaque", creditorRef: "creditor-opaque" }],
};
const verifiedConversation: PersistedConversation = {
  id: "conversation-internal",
  organizationId: "organization-opaque",
  organizationExternalRef: "organization-external",
  organizationTimeZone: "America/Sao_Paulo",
  publicReference: "conv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  state: "IDENTITY_VERIFIED",
  debtorRef: "debtor-opaque",
  verifiedDebtorContext: verifiedContext,
  identityStatus: "VERIFIED",
  failedIdentityAttempts: 0,
  identityLockedAt: null,
  startedAt: now,
  lastActivityAt: now,
  endedAt: null,
  optedOutAt: null,
  messages: [],
};
const debt = {
  debtRef: "debt-one",
  debtorRef: "debtor-opaque",
  creditor: { creditorRef: "creditor-opaque", displayName: "Credor Fictício" },
  description: "Conta demonstrativa",
  amount: { amountInCents: 123_457, currency: "BRL" as const },
  dueDate: "2026-09-10",
  status: "OPEN" as const,
  providerVersion: "debt-version-1",
};
const offer = {
  offerRef: "offer-one",
  debtRef: debt.debtRef,
  debtorRef: debt.debtorRef,
  creditorRef: debt.creditor.creditorRef,
  providerVersion: "offer-version-1",
  terms: {
    kind: "INSTALLMENT" as const,
    total: { amountInCents: 110_003, currency: "BRL" as const },
    downPayment: { amountInCents: 10_001, currency: "BRL" as const },
    installmentCount: 5,
    installmentAmount: { amountInCents: 20_000, currency: "BRL" as const },
    firstDueDate: "2026-09-20",
  },
  expiresAt: "2026-09-15T23:59:59.000Z",
  status: "AVAILABLE" as const,
};

class Store implements ConversationStore {
  audits: AuditInput[] = [];
  constructor(private readonly conversation: PersistedConversation) {}
  async findActiveOrganizationBySlug(): Promise<PersistedOrganization | null> { return null; }
  async createConversation(): Promise<PersistedConversation> { throw new Error("unused"); }
  async authenticateConversation(reference: string, tokenHash: string) {
    return reference === this.conversation.publicReference && tokenHash === hashSessionToken(token, sessionSecret)
      ? this.conversation
      : null;
  }
  async recordIdentification(): Promise<PersistedConversation> { throw new Error("unused"); }
  async recordIdentityAttempt(): Promise<PersistedConversation> { throw new Error("unused"); }
  async recordAudit(input: { audit: AuditInput }) { this.audits.push(input.audit); }
  async recordTerminalState(): Promise<PersistedConversation> { throw new Error("unused"); }
}

function provider() {
  return {
    getDebt: vi.fn(async (_organization, _debtor, debtRef: string) => {
      if (debtRef === debt.debtRef) return debt;
      if (debtRef === "debt-two") return { ...debt, debtRef: "debt-two" };
      throw new ApplicationError("PROVIDER_RESOURCE_NOT_FOUND", "Recurso demonstrativo não encontrado.", 404);
    }),
    getAuthorizedOffer: vi.fn(async (_organization, _debtor, offerRef: string) => {
      if (offerRef === offer.offerRef) return offer;
      if (offerRef === "offer-other-debt") return { ...offer, offerRef, debtRef: "debt-two" };
      throw new ApplicationError("PROVIDER_RESOURCE_NOT_FOUND", "Recurso demonstrativo não encontrado.", 404);
    }),
  } as unknown as DebtProvider;
}

function operationalStore(): AiOperationalStore {
  return {
    async reserve() { return { kind: "RESERVED", executionId: "execution-opaque" }; },
    async complete() {},
    async finalizeWithoutCall(input) { return input.response; },
  };
}

function service(input: {
  conversation?: PersistedConversation;
  debtProvider?: DebtProvider;
  interpret?: NaturalLanguageIntentClient["interpret"];
}) {
  const interpret = input.interpret ?? vi.fn(async (turn: NormalizedInboundTurn) => ({
    output: {
      intent: "HELP" as const,
      confidence: "HIGH" as const,
      explanationSegments: turn.canonicalFacts.slice(-7).map((fact: CanonicalFact) => ({
        type: "FACT_REF" as const,
        text: null,
        factKey: fact.key,
      })),
      suggestedActions: [],
    },
    usage: { inputTokens: 20, outputTokens: 10 },
  }));
  const target = new ConversationTurnService(
    new Store(input.conversation ?? verifiedConversation),
    new ConversationTurnOrchestrator({ interpret }, new ReservedAiUsageBudgetGate(), {
      enabled: true,
      model: "configured-model",
    }),
    sessionSecret,
    3_600,
    () => now,
    operationalStore(),
    {
      enabled: true,
      model: "configured-model",
      safetyHmacSecret: "s".repeat(64),
      maxInputTokens: 1_000,
      maxOutputTokens: 100,
      maxCallsPerConversation: 5,
      dailyBudgetUsd: 0.5,
      monthlyBudgetUsd: 5,
      circuitFailureThreshold: 5,
      circuitOpenSeconds: 60,
      reservationTtlMs: 20_000,
    },
    input.debtProvider ?? provider(),
  );
  return { target, interpret };
}

const baseInput = {
  publicReference: verifiedConversation.publicReference,
  token,
  message: "Pode explicar esta dívida?",
  clientTurnId: "00000000-0000-4000-8000-000000000301",
  uiContext: "DEBT_DETAIL" as const,
  requestId: "request-opaque",
};

describe("canonical conversation context", () => {
  it("reloads complete debt and offer context and exposes only aliases to interpretation", async () => {
    const debtProvider = provider();
    const { target, interpret } = service({ debtProvider });
    const result = await target.interpret({
      ...baseInput,
      message: "Pode explicar como funciona esta proposta?",
      uiContext: "OFFER_REVIEW",
      selectedDebtRef: debt.debtRef,
      selectedOfferRef: offer.offerRef,
    });
    const turn = vi.mocked(interpret).mock.calls[0][0];
    expect(turn.canonicalFacts.map((fact) => fact.key)).toEqual([
      "debt_description", "debt_amount", "debt_due_date", "debt_status",
      "offer_kind", "offer_total", "offer_down_payment", "offer_installment_count",
      "offer_installment_amount", "offer_first_due_date", "offer_expires_at",
    ]);
    expect(debtProvider.getDebt).toHaveBeenCalledOnce();
    expect(debtProvider.getAuthorizedOffer).toHaveBeenCalledOnce();
    expect(result.message).toContain("Modalidade: parcelada.");
    expect(result.message).toContain("Quantidade de parcelas: 5.");
    expect(result.message).not.toContain(debt.debtRef);
    expect(result.message).not.toContain(offer.offerRef);
    expect(result.requiresConfirmation).toBe(false);
  });

  it("explains a selected debt without requiring an offer", async () => {
    const interpret = vi.fn(async (turn: NormalizedInboundTurn) => ({
      output: {
        intent: "HELP" as const,
        confidence: "HIGH" as const,
        explanationSegments: turn.canonicalFacts.map((fact: CanonicalFact) => ({ type: "FACT_REF" as const, text: null, factKey: fact.key })),
        suggestedActions: ["LIST_OFFERS" as const],
      },
      usage: { inputTokens: 10, outputTokens: 5 },
    }));
    const { target } = service({ interpret });
    const result = await target.interpret({ ...baseInput, selectedDebtRef: debt.debtRef });
    expect(result.message).toContain("Conta demonstrativa");
    expect(result.message).toContain("em aberto");
    expect(result.suggestedActions).toContain("LIST_OFFERS");
  });

  it("asks for proposal selection without calling the model when offer context is absent", async () => {
    const { target, interpret } = service({});
    const result = await target.interpret({
      ...baseInput,
      message: "Pode explicar esta proposta parcelada?",
      selectedDebtRef: debt.debtRef,
    });
    expect(result.message).toBe("Selecione uma proposta para que eu possa explicar as condições.");
    expect(interpret).not.toHaveBeenCalled();
  });

  it("rejects an altered debt reference safely", async () => {
    const { target, interpret } = service({});
    await expect(target.interpret({ ...baseInput, selectedDebtRef: "debt-altered" }))
      .rejects.toMatchObject({ code: "PROVIDER_RESOURCE_NOT_FOUND", status: 404 });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("rejects an offer that belongs to another debt", async () => {
    const { target, interpret } = service({});
    await expect(target.interpret({
      ...baseInput,
      selectedDebtRef: debt.debtRef,
      selectedOfferRef: "offer-other-debt",
    })).rejects.toMatchObject({ code: "CONTEXT_REFERENCE_INVALID", status: 400 });
    expect(interpret).not.toHaveBeenCalled();
  });

  it("does not load context before identity verification", async () => {
    const unverified = {
      ...verifiedConversation,
      state: "STARTED" as const,
      identityStatus: "NOT_STARTED" as const,
      verifiedDebtorContext: null,
    };
    const debtProvider = provider();
    const { target, interpret } = service({ conversation: unverified, debtProvider });
    await expect(target.interpret({ ...baseInput, selectedDebtRef: debt.debtRef }))
      .rejects.toMatchObject({ code: "IDENTITY_VERIFICATION_REQUIRED", status: 403 });
    expect(debtProvider.getDebt).not.toHaveBeenCalled();
    expect(interpret).not.toHaveBeenCalled();
  });

  it("keeps canonical facts empty when no selection is provided", async () => {
    const { target, interpret } = service({});
    await target.interpret(baseInput);
    expect(vi.mocked(interpret).mock.calls[0][0].canonicalFacts).toEqual([]);
  });
});
