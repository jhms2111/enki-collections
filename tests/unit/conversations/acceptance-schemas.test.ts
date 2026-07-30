import { describe, expect, it } from "vitest";

import {
  idempotencyHeaderSchema,
  offerAcceptanceSchema,
  paymentInstrumentSchema,
} from "@/modules/conversations/acceptance.schemas";

describe("acceptance schemas", () => {
  const validTerms = {
    kind: "CASH",
    total: { amountInCents: 39_000, currency: "BRL" },
    downPayment: { amountInCents: 39_000, currency: "BRL" },
    installmentCount: 1,
    installmentAmount: {
      amountInCents: 39_000,
      currency: "BRL",
    },
    firstDueDate: "2099-08-15",
  };

  it("requires explicit true confirmation and exact positive terms", () => {
    expect(() =>
      offerAcceptanceSchema.parse({
        confirmation: false,
        expectedProviderVersion: "offer-v3",
        expectedTerms: validTerms,
      }),
    ).toThrow();
    expect(() =>
      offerAcceptanceSchema.parse({
        confirmation: true,
        expectedProviderVersion: "offer-v3",
        expectedTerms: {
          ...validTerms,
          total: { amountInCents: 0, currency: "BRL" },
        },
      }),
    ).toThrow();
  });

  it("accepts only constrained idempotency headers", () => {
    expect(
      idempotencyHeaderSchema.parse("client-key-acceptance-0001"),
    ).toBe("client-key-acceptance-0001");
    expect(() => idempotencyHeaderSchema.parse("short")).toThrow();
    expect(() =>
      idempotencyHeaderSchema.parse("invalid key with spaces"),
    ).toThrow();
  });

  it("accepts only demonstration instrument types", () => {
    expect(paymentInstrumentSchema.parse({ type: "DEMO_PIX" })).toEqual({
      type: "DEMO_PIX",
    });
    expect(() =>
      paymentInstrumentSchema.parse({ type: "PIX" }),
    ).toThrow();
  });
});
