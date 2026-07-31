import { describe, expect, it } from "vitest";

import { presentAuthorizedOffers } from "@/modules/conversations/debt.dto";
import type { AuthorizedOffer } from "@/modules/debt-provider/debt-provider.types";

describe("public authorized offer terms", () => {
  it("preserves the provider terms as the canonical object without normalization", () => {
    const terms = {
      kind: "INSTALLMENT" as const,
      total: { amountInCents: 123_457, currency: "BRL" as const },
      downPayment: { amountInCents: 12_301, currency: "BRL" as const },
      installmentCount: 7,
      installmentAmount: {
        amountInCents: 15_879,
        currency: "BRL" as const,
      },
      firstDueDate: "2026-09-07",
    };
    const providerOffer: AuthorizedOffer = {
      offerRef: "offer-structural-test",
      debtRef: "debt-structural-test",
      debtorRef: "debtor-private-ref",
      creditorRef: "creditor-private-ref",
      providerVersion: "version-structural-test",
      terms,
      expiresAt: "2099-12-31T23:59:59.000Z",
      status: "AVAILABLE",
    };

    const publicOffer = presentAuthorizedOffers(
      [providerOffer],
      new Date("2026-07-30T00:00:00.000Z"),
    ).offers[0];

    expect(publicOffer.terms).toBe(terms);
    expect(publicOffer.terms).toStrictEqual(providerOffer.terms);
    expect(publicOffer).toMatchObject({
      kind: terms.kind,
      total: terms.total,
      downPayment: terms.downPayment,
      installmentCount: terms.installmentCount,
      installmentAmount: terms.installmentAmount,
      firstDueDate: terms.firstDueDate,
    });
    expect(JSON.stringify(publicOffer)).not.toContain("debtor-private-ref");
    expect(JSON.stringify(publicOffer)).not.toContain("creditor-private-ref");
    expect(publicOffer).not.toHaveProperty("organizationId");
  });
});
