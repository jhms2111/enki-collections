import type { AuthorizedOffer, Money } from "@/modules/debt-provider/debt-provider.types";
import type { OfferPresentation, OfferPresentationPolicy } from "@/modules/webchat/offer-presentation-policy";

const installmentTemplate = "Essa proposta tem valor total de {offer_total}, dividido em {offer_installment_count} parcelas de {offer_installment_amount}. A primeira parcela corresponde à entrada, com vencimento em {offer_first_due_date}. A proposta é válida até {offer_expires_at}.";
const cashTemplate = "Essa proposta é para pagamento à vista, com valor total de {offer_total} e vencimento em {offer_first_due_date}. A proposta é válida até {offer_expires_at}.";
const allowedAliases = new Set([
  "offer_total",
  "offer_installment_count",
  "offer_installment_amount",
  "offer_first_due_date",
  "offer_expires_at",
]);

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "long",
  timeZone: "UTC",
});

function formatMoney(value: Money | undefined): string | null {
  if (!value || value.currency !== "BRL" || !Number.isSafeInteger(value.amountInCents) || value.amountInCents < 0) return null;
  return currencyFormatter.format(value.amountInCents / 100);
}

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00.000Z` : value);
  return Number.isNaN(parsed.getTime()) ? null : dateFormatter.format(parsed);
}

export function renderSandboxOfferTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string | null {
  let invalid = false;
  const rendered = template.replace(/\{([A-Za-z0-9_-]+)\}/g, (_match, alias: string) => {
    if (!allowedAliases.has(alias) || !Object.hasOwn(values, alias) || !values[alias]) {
      invalid = true;
      return "";
    }
    return values[alias];
  });
  if (invalid || /\{[A-Za-z0-9_-]+\}/.test(rendered)) return null;
  return rendered;
}

/** Presentation semantics are exclusive to SandboxDebtProvider fixtures. */
export class SandboxOfferPresentationPolicy implements OfferPresentationPolicy {
  present(offer: AuthorizedOffer): OfferPresentation | null {
    const total = formatMoney(offer.terms.total);
    const firstDueDate = formatDate(offer.terms.firstDueDate);
    const expiresAt = formatDate(offer.expiresAt);
    if (!total || !firstDueDate || !expiresAt) return null;

    if (offer.terms.kind === "CASH") {
      const publicText = renderSandboxOfferTemplate(cashTemplate, {
        offer_total: total,
        offer_first_due_date: firstDueDate,
        offer_expires_at: expiresAt,
      });
      return publicText ? { publicText, replayMarker: "[[OFFER_PRESENTATION:sandbox-cash-v1]]" } : null;
    }

    const installmentAmount = formatMoney(offer.terms.installmentAmount);
    const count = offer.terms.installmentCount;
    const downPaymentIsFirstInstallment =
      offer.terms.downPayment.currency === offer.terms.installmentAmount.currency &&
      offer.terms.downPayment.amountInCents === offer.terms.installmentAmount.amountInCents;
    if (!installmentAmount || !Number.isSafeInteger(count) || count < 2 || !downPaymentIsFirstInstallment) return null;
    const publicText = renderSandboxOfferTemplate(installmentTemplate, {
      offer_total: total,
      offer_installment_count: String(count),
      offer_installment_amount: installmentAmount,
      offer_first_due_date: firstDueDate,
      offer_expires_at: expiresAt,
    });
    return publicText ? { publicText, replayMarker: "[[OFFER_PRESENTATION:sandbox-installment-v1]]" } : null;
  }
}
