import { afterEach, describe, expect, it, vi } from "vitest";

import {
  acceptOffer,
  closeConversation,
  interpretConversationTurn,
  optOutConversation,
  registerPromise,
  type Offer,
} from "@/modules/demo-ui/demo-api";

afterEach(() => vi.unstubAllGlobals());

describe("demo api client", () => {
  it("sends only bounded conversational context for interpretation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ turn: { intent: "HELP", message: "Ajuda", suggestedActions: [], requiresConfirmation: false, fallbackUsed: true } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await interpretConversationTurn({
      conversationId: "conv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      message: "ajuda",
      clientTurnId: "00000000-0000-4000-8000-000000000012",
      uiContext: "IDENTITY",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({
      message: "ajuda",
      clientTurnId: "00000000-0000-4000-8000-000000000012",
      uiContext: "IDENTITY",
    });
    expect(body).not.toHaveProperty("organizationId");
    expect(body).not.toHaveProperty("amount");
    expect(body).not.toHaveProperty("offerRef");
  });

  it("uses strict explicit confirmation for terminal commands", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ conversation: { state: "CLOSED" } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const reference = "conv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    await closeConversation(reference);
    await optOutConversation(reference);

    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(String(call[1].body))).toEqual({ confirmation: true });
      expect(call[1].method).toBe("POST");
    }
    expect(fetchMock.mock.calls[0][0]).toContain("/close");
    expect(fetchMock.mock.calls[1][0]).toContain("/opt-out");
  });

  it("sends the canonical public terms unchanged as expectedTerms", async () => {
    const terms = {
      kind: "INSTALLMENT" as const,
      total: { amountInCents: 123_457, currency: "BRL" as const },
      downPayment: { amountInCents: 12_301, currency: "BRL" as const },
      installmentCount: 7,
      installmentAmount: { amountInCents: 15_879, currency: "BRL" as const },
      firstDueDate: "2026-09-07",
    };
    const offer: Offer = {
      offerRef: "offer-test",
      providerVersion: "version-test",
      debtRef: "debt-test",
      terms,
      kind: terms.kind,
      total: terms.total,
      downPayment: terms.downPayment,
      installmentCount: terms.installmentCount,
      installmentAmount: terms.installmentAmount,
      firstDueDate: terms.firstDueDate,
      expiresAt: "2099-12-31T23:59:59.000Z",
      status: "AVAILABLE",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          acceptance: {
            id: "accept_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            debtRef: "debt-test",
            offerRef: "offer-test",
            acceptedAt: "2026-07-30T12:00:00.000Z",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await acceptOffer({
      conversationId: "conv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      debtRef: "debt-test",
      offer,
      idempotencyKey: "web:00000000-0000-4000-8000-000000000001",
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body.expectedTerms).toStrictEqual(terms);
    expect(body.expectedTerms).toEqual({
      kind: "INSTALLMENT",
      total: { amountInCents: 123_457, currency: "BRL" },
      downPayment: { amountInCents: 12_301, currency: "BRL" },
      installmentCount: 7,
      installmentAmount: { amountInCents: 15_879, currency: "BRL" },
      firstDueDate: "2026-09-07",
    });
    expect(body).not.toHaveProperty("organizationId");
    expect(body).not.toHaveProperty("debtorRef");
  });

  it("uses offerRef, not acceptanceId, in the promise contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          promise: {
            id: "promise_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            promisedDate: "2026-09-07",
            status: "RECORDED",
          },
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await registerPromise({
      conversationId: "conv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      debtRef: "debt-test",
      promisedDate: "2026-09-07",
      offerRef: "offer-test",
      idempotencyKey: "web:00000000-0000-4000-8000-000000000002",
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toEqual({
      promisedDate: "2026-09-07",
      offerRef: "offer-test",
    });
    expect(body).not.toHaveProperty("acceptanceId");
  });
});
