import { describe, expect, it } from "vitest";

import { SandboxOfferPresentationPolicy, renderSandboxOfferTemplate } from "@/modules/debt-provider/sandbox/sandbox-offer-presentation-policy";
import type { AuthorizedOffer } from "@/modules/debt-provider/debt-provider.types";

const installmentOffer: AuthorizedOffer = {
  offerRef: "opaque-offer",
  debtRef: "opaque-debt",
  debtorRef: "opaque-debtor",
  creditorRef: "opaque-creditor",
  providerVersion: "sandbox-offer-v1",
  terms: {
    kind: "INSTALLMENT",
    total: { amountInCents: 45_000, currency: "BRL" },
    downPayment: { amountInCents: 7_500, currency: "BRL" },
    installmentCount: 6,
    installmentAmount: { amountInCents: 7_500, currency: "BRL" },
    firstDueDate: "2099-08-15",
  },
  expiresAt: "2099-08-15T23:59:59.000Z",
  status: "AVAILABLE",
};

describe("SandboxOfferPresentationPolicy", () => {
  const presenter = new SandboxOfferPresentationPolicy();

  it("presents an installment proposal with its down payment as the first installment", () => {
    expect(presenter.present(installmentOffer)?.publicText).toBe(
      "Essa proposta tem valor total de R$ 450,00, dividido em 6 parcelas de R$ 75,00. A primeira parcela corresponde à entrada, com vencimento em 15 de agosto de 2099. A proposta é válida até 15 de agosto de 2099.",
    );
  });

  it("uses a natural cash template without installment language", () => {
    const result = presenter.present({
      ...installmentOffer,
      terms: {
        ...installmentOffer.terms,
        kind: "CASH",
        total: { amountInCents: 40_000, currency: "BRL" },
        downPayment: { amountInCents: 40_000, currency: "BRL" },
        installmentCount: 1,
        installmentAmount: { amountInCents: 40_000, currency: "BRL" },
      },
    });
    expect(result?.publicText).toBe(
      "Essa proposta é para pagamento à vista, com valor total de R$ 400,00 e vencimento em 15 de agosto de 2099. A proposta é válida até 15 de agosto de 2099.",
    );
    expect(result?.publicText).not.toMatch(/parcela|entrada/i);
  });

  it("falls back when the sandbox first payment semantics are inconsistent", () => {
    expect(presenter.present({
      ...installmentOffer,
      terms: {
        ...installmentOffer.terms,
        downPayment: { amountInCents: 10_000, currency: "BRL" },
      },
    })).toBeNull();
  });

  it("falls back when a mandatory fact is absent", () => {
    const malformed = {
      ...installmentOffer,
      terms: { ...installmentOffer.terms, firstDueDate: undefined },
    } as unknown as AuthorizedOffer;
    expect(presenter.present(malformed)).toBeNull();
  });

  it("rejects unknown aliases", () => {
    expect(renderSandboxOfferTemplate("Texto {unknown_alias}.", { unknown_alias: "x" })).toBeNull();
  });

  it("keeps output concise and free from technical language", () => {
    const text = presenter.present(installmentOffer)!.publicText;
    expect(text.trim().split(/\s+/).length).toBeLessThanOrEqual(70);
    expect(text.split(/[.!?]+/).filter((sentence) => sentence.trim())).toHaveLength(3);
    expect(text).not.toMatch(/FACT_REF|backend|Policy Gate|OpenAI|offer_|\{[^}]+\}/i);
  });
});
