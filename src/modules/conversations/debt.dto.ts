import type {
  AuthorizedOffer,
  DebtDetails,
  DebtSummary,
  Money,
} from "@/modules/debt-provider/debt-provider.types";

type PublicMoney = Readonly<{
  amountInCents: number;
  currency: "BRL";
}>;

function presentMoney(money: Money): PublicMoney {
  return {
    amountInCents: money.amountInCents,
    currency: money.currency,
  };
}

function presentDebt(debt: DebtSummary) {
  return {
    debtRef: debt.debtRef,
    description: debt.description,
    amount: presentMoney(debt.amount),
    dueDate: debt.dueDate,
    status: debt.status,
  };
}

export function presentGroupedDebts(debts: readonly DebtSummary[]) {
  const creditors = new Map<
    string,
    {
      creditorRef: string;
      displayName: string;
      debts: ReturnType<typeof presentDebt>[];
    }
  >();

  for (const debt of debts) {
    const group = creditors.get(debt.creditor.creditorRef) ?? {
      creditorRef: debt.creditor.creditorRef,
      displayName: debt.creditor.displayName,
      debts: [],
    };
    group.debts.push(presentDebt(debt));
    creditors.set(debt.creditor.creditorRef, group);
  }

  return {
    creditors: [...creditors.values()],
  };
}

export function presentDebtDetails(debt: DebtDetails) {
  return {
    creditor: debt.creditor,
    ...presentDebt(debt),
  };
}

export function presentAuthorizedOffers(
  offers: readonly AuthorizedOffer[],
  now: Date,
) {
  return {
    offers: offers.map((offer) => ({
      offerRef: offer.offerRef,
      providerVersion: offer.providerVersion,
      debtRef: offer.debtRef,
      terms: offer.terms,
      kind: offer.terms.kind,
      total: presentMoney(offer.terms.total),
      downPayment: presentMoney(offer.terms.downPayment),
      installmentCount: offer.terms.installmentCount,
      installmentAmount: presentMoney(offer.terms.installmentAmount),
      firstDueDate: offer.terms.firstDueDate,
      expiresAt: offer.expiresAt,
      status:
        offer.status === "AVAILABLE" &&
        new Date(offer.expiresAt).getTime() <= now.getTime()
          ? ("EXPIRED" as const)
          : offer.status,
    })),
  };
}
