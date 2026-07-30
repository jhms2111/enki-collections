import { describe, expect, it } from "vitest";

import {
  disputeSchema,
  paymentPromiseSchema,
  paymentReportSchema,
} from "@/modules/conversations/occurrence.schemas";

describe("occurrence schemas", () => {
  it("accepts only the approved payment promise fields", () => {
    expect(
      paymentPromiseSchema.parse({
        promisedDate: "2026-08-10",
        offerRef: "offer-cash-001",
      }),
    ).toEqual({
      promisedDate: "2026-08-10",
      offerRef: "offer-cash-001",
    });
    for (const forbidden of [
      "amount",
      "discount",
      "installments",
      "paymentStatus",
    ]) {
      expect(
        paymentPromiseSchema.safeParse({
          promisedDate: "2026-08-10",
          [forbidden]: "forbidden",
        }).success,
      ).toBe(false);
    }
  });

  it("preserves a valid reportedAt and rejects proofs and financial state", () => {
    expect(
      paymentReportSchema.parse({
        reportedAt: "2026-07-30T10:15:00.000Z",
      }).reportedAt,
    ).toBe("2026-07-30T10:15:00.000Z");
    expect(
      paymentReportSchema.safeParse({
        reportedAt: "2026-07-30T10:15:00.000Z",
        proof: "base64",
      }).success,
    ).toBe(false);
    expect(
      paymentReportSchema.safeParse({
        reportedAt: "2026-07-30T10:15:00.000Z",
        paid: true,
      }).success,
    ).toBe(false);
  });

  it("strictly limits disputes and rejects browser-provided decisions", () => {
    expect(
      disputeSchema.safeParse({
        reasonCode: "OTHER",
        description: "x".repeat(301),
      }).success,
    ).toBe(false);
    expect(
      disputeSchema.safeParse({
        reasonCode: "NOT_RECOGNIZED",
        description: "Descrição curta.",
        status: "ACCEPTED",
      }).success,
    ).toBe(false);
  });
});
