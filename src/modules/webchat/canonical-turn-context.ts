import type {
  AuthorizedOffer,
  DebtDetails,
  Money,
} from "@/modules/debt-provider/debt-provider.types";

import type { CanonicalFact } from "./conversation-turn.types";

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeZone: "UTC",
});

function money(value: Money): string {
  return moneyFormatter.format(value.amountInCents / 100);
}

function date(value: string): string {
  return dateFormatter.format(new Date(`${value.slice(0, 10)}T12:00:00.000Z`));
}

function dateTime(value: string): string {
  return dateFormatter.format(new Date(value));
}

export function buildDebtCanonicalFacts(debt: DebtDetails): readonly CanonicalFact[] {
  const status = debt.status === "OPEN"
    ? "em aberto"
    : debt.status === "DISPUTED"
      ? "contestação pendente"
      : "pagamento informado pelo provider";
  return [
    { key: "debt_description", displayText: `Descrição da dívida: ${debt.description}.` },
    { key: "debt_amount", displayText: `Valor informado: ${money(debt.amount)}.` },
    { key: "debt_due_date", displayText: `Vencimento informado: ${date(debt.dueDate)}.` },
    { key: "debt_status", displayText: `Situação informada: ${status}.` },
  ];
}

export function buildOfferCanonicalFacts(offer: AuthorizedOffer): readonly CanonicalFact[] {
  const terms = offer.terms;
  return [
    { key: "offer_kind", displayText: `Modalidade: ${terms.kind === "CASH" ? "à vista" : "parcelada"}.` },
    { key: "offer_total", displayText: `Total da proposta: ${money(terms.total)}.` },
    { key: "offer_down_payment", displayText: `Entrada: ${money(terms.downPayment)}.` },
    { key: "offer_installment_count", displayText: `Quantidade de parcelas: ${terms.installmentCount}.` },
    { key: "offer_installment_amount", displayText: `Valor de cada parcela: ${money(terms.installmentAmount)}.` },
    { key: "offer_first_due_date", displayText: `Primeiro vencimento: ${date(terms.firstDueDate)}.` },
    { key: "offer_expires_at", displayText: `Validade da proposta: ${dateTime(offer.expiresAt)}.` },
  ];
}
