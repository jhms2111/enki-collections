import { describe, expect, it } from "vitest";

import {
  conversationTurnRequestSchema,
  openAIIntentOutputSchema,
} from "@/modules/webchat/conversation-turn.schemas";

describe("conversation turn schemas", () => {
  it("accepts only optional opaque debt and offer context references", () => {
    const parsed = conversationTurnRequestSchema.parse({
      message: "Explique esta proposta",
      clientTurnId: "00000000-0000-4000-8000-000000000010",
      uiContext: "OFFER_REVIEW",
      selectedDebtRef: "debt_opaque",
      selectedOfferRef: "offer_opaque",
    });
    expect(parsed.selectedDebtRef).toBe("debt_opaque");
    expect(parsed.selectedOfferRef).toBe("offer_opaque");
    expect(() => conversationTurnRequestSchema.parse({
      ...parsed,
      selectedDebtRef: undefined,
    })).toThrow();
    expect(() => conversationTurnRequestSchema.parse({
      ...parsed,
      amount: 100,
    })).toThrow();
  });
  it("accepts only the bounded public request", () => {
    const request = {
      message: "Quero ajuda",
      clientTurnId: "00000000-0000-4000-8000-000000000011",
      uiContext: "IDENTITY" as const,
    };
    expect(conversationTurnRequestSchema.parse(request)).toEqual(request);
    for (const extra of [
      { amount: 100 },
      { offerRef: "offer-internal" },
      { organizationId: "org-internal" },
      { confirmation: true },
      { state: "OFFER_ACCEPTED" },
    ]) {
      expect(() => conversationTurnRequestSchema.parse({ ...request, ...extra })).toThrow();
    }
  });

  it("rejects malformed segments and model fields outside the strict schema", () => {
    const base = {
      intent: "HELP" as const,
      confidence: "HIGH" as const,
      explanationSegments: [{ type: "TEXT" as const, text: "Ajuda segura.", factKey: null }],
      suggestedActions: ["HELP" as const],
    };
    expect(openAIIntentOutputSchema.parse(base)).toEqual(base);
    expect(() => openAIIntentOutputSchema.parse({ ...base, mutationPayload: {} })).toThrow();
    expect(() => openAIIntentOutputSchema.parse({
      ...base,
      explanationSegments: [{ type: "FACT_REF", text: "valor inventado", factKey: "fact" }],
    })).toThrow();
  });
});
