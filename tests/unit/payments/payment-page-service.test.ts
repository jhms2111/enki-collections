import { describe, expect, it, vi } from "vitest";

import type { PersistedOfferAcceptance } from "@/modules/conversations/acceptance-store";
import type { PersistedConversation } from "@/modules/conversations/persistence.types";
import type { DebtProvider } from "@/modules/debt-provider/debt-provider";
import { PaymentPageService } from "@/modules/payments/payment-page-service";
import type { PaymentContextStore } from "@/modules/payments/payment-context-store";
import type { PaymentProvider } from "@/modules/payments/payment-provider";

const token = "opaque-session-token";
const terms = { kind: "INSTALLMENT" as const, total: { amountInCents: 45000, currency: "BRL" as const }, downPayment: { amountInCents: 7500, currency: "BRL" as const }, installmentCount: 6, installmentAmount: { amountInCents: 7500, currency: "BRL" as const }, firstDueDate: "2099-08-15" };
const conversation: PersistedConversation = {
  id: "conversation_internal", organizationId: "org_demo", organizationExternalRef: "org_external", organizationTimeZone: "America/Sao_Paulo", publicReference: "conv_12345678901234567890123456789012", state: "OFFER_ACCEPTED", debtorRef: "debtor_demo", verifiedDebtorContext: { verificationRef: "verification_demo", authorizedAccounts: [{ debtorRef: "debtor_demo", creditorRef: "creditor_demo" }] }, identityStatus: "VERIFIED", failedIdentityAttempts: 0, identityLockedAt: null, startedAt: new Date("2026-08-18T10:00:00Z"), lastActivityAt: new Date("2026-08-18T10:05:00Z"), endedAt: null, optedOutAt: null, messages: [],
};
const acceptance: PersistedOfferAcceptance = { id: "acceptance_internal", organizationId: "org_demo", conversationId: conversation.id, publicReference: "accept_12345678901234567890123456789012", debtRef: "debt_demo", offerRef: "offer_demo", providerAcceptanceRef: "provider_acceptance_demo", providerVersion: "version_demo", termsSnapshot: terms, acceptedAt: new Date("2026-08-18T10:04:00Z") };

function setup() {
  const store: PaymentContextStore = {
    authenticateBySession: vi.fn(async () => ({ conversation, organizationSlug: "jf-demo" })),
    findLatestAcceptance: vi.fn(async () => acceptance),
  };
  const provider = {
    getDebt: vi.fn(async () => ({ debtRef: "debt_demo", debtorRef: "debtor_demo", creditor: { creditorRef: "creditor_demo", displayName: "Credor Aurora Demonstrativo" }, description: "Conta demonstrativa", amount: { amountInCents: 50000, currency: "BRL" }, dueDate: "2099-07-10", status: "OPEN", providerVersion: "debt_version" })),
    getAuthorizedOffer: vi.fn(async () => ({ offerRef: "offer_demo", debtRef: "debt_demo", debtorRef: "debtor_demo", creditorRef: "creditor_demo", providerVersion: "version_demo", terms, expiresAt: "2099-08-15", status: "AVAILABLE" })),
  } as unknown as DebtProvider;
  const createInstrument = vi.fn(async () => ({ instrument: { type: "DEMO_PIX" as const, displayValue: "PIX-DEMO-NOT-PAYABLE", expiresAt: "2099-08-15T23:59:59.000Z", isDemo: true as const, warning: "DEMONSTRAÇÃO — SEM VALOR FINANCEIRO" as const } }));
  const paymentProvider = { createDemonstrativeInstrument: createInstrument } as unknown as PaymentProvider;
  return { service: new PaymentPageService(store, provider, paymentProvider, "session-secret-long-enough", 3600, () => new Date("2026-08-18T10:10:00Z")), store, provider, createInstrument };
}

describe("PaymentPageService", () => {
  it("re-reads canonical debt and offer and exposes no opaque references", async () => {
    const { service, provider } = setup();
    const result = await service.getContext({ slug: "jf-demo", token, requestId: "request_demo" });
    expect(provider.getDebt).toHaveBeenCalledOnce();
    expect(provider.getAuthorizedOffer).toHaveBeenCalledOnce();
    expect(result.terms).toEqual(terms);
    expect(JSON.stringify(result)).not.toMatch(/debt_demo|offer_demo|accept_|conversation_internal|org_demo/);
  });

  it("rejects missing sessions and organization mismatch", async () => {
    const missing = setup();
    await expect(missing.service.getContext({ slug: "jf-demo", token: undefined, requestId: "request_demo" })).rejects.toMatchObject({ code: "SESSION_REQUIRED" });
    const mismatch = setup();
    vi.mocked(mismatch.store.authenticateBySession).mockResolvedValue({ conversation, organizationSlug: "atlas-demo" });
    await expect(mismatch.service.getContext({ slug: "jf-demo", token, requestId: "request_demo" })).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("delegates instrument generation with server-only conversation and acceptance references", async () => {
    const { service, createInstrument } = setup();
    await service.createInstrument({ slug: "jf-demo", token, type: "DEMO_PIX", idempotencyKey: "client-key-payment-0001", requestId: "request_demo" });
    expect(createInstrument).toHaveBeenCalledWith(expect.objectContaining({ conversationReference: conversation.publicReference, acceptanceReference: acceptance.publicReference, sessionToken: token, type: "DEMO_PIX" }));
  });
});
