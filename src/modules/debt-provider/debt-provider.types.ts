export type Currency = "BRL";

export type Money = Readonly<{
  amountInCents: number;
  currency: Currency;
}>;

export type DemoDebtorIdentifier = Readonly<{
  type: "DEMO_ID";
  value: string;
}>;

export type DebtorAccountRef = Readonly<{
  debtorRef: string;
  creditorRef: string;
}>;

export type DebtorIdentification = Readonly<{
  identificationRef: string;
  maskedDisplayName: string;
  accounts: readonly DebtorAccountRef[];
}>;

export type IdentityChallenge = Readonly<{
  challengeRef: string;
  prompt: string;
  options: readonly Readonly<{
    optionRef: string;
    label: string;
  }>[];
  maxAttempts: number;
}>;

export type IdentityVerification =
  | Readonly<{
      verified: true;
      debtorContext: VerifiedDebtorContext;
    }>
  | Readonly<{
      verified: false;
      attemptsRemaining: number;
      blocked: boolean;
    }>;

export type VerifiedDebtorContext = Readonly<{
  verificationRef: string;
  authorizedAccounts: readonly DebtorAccountRef[];
}>;

export type CreditorSummary = Readonly<{
  creditorRef: string;
  displayName: string;
}>;

export type DebtSummary = Readonly<{
  debtRef: string;
  debtorRef: string;
  creditor: CreditorSummary;
  description: string;
  amount: Money;
  dueDate: string;
  status: "OPEN" | "DISPUTED" | "PAID";
}>;

export type DebtDetails = DebtSummary &
  Readonly<{
    providerVersion: string;
  }>;

export type OfferTerms = Readonly<{
  kind: "CASH" | "INSTALLMENT";
  total: Money;
  downPayment: Money;
  installmentCount: number;
  installmentAmount: Money;
  firstDueDate: string;
}>;

export type AuthorizedOffer = Readonly<{
  offerRef: string;
  debtRef: string;
  debtorRef: string;
  creditorRef: string;
  providerVersion: string;
  terms: OfferTerms;
  expiresAt: string;
  status: "AVAILABLE" | "EXPIRED" | "DISABLED";
}>;

export type OfferAcceptanceInput = Readonly<{
  idempotencyKey: string;
  offerRef: string;
  expectedProviderVersion: string;
  expectedTerms: OfferTerms;
  acceptedAt: string;
}>;

export type OfferAcceptanceResult = Readonly<{
  acceptanceRef: string;
  offerRef: string;
  providerVersion: string;
  acceptedAt: string;
}>;

export type DemoPaymentInstrumentType =
  | "DEMO_LINK"
  | "DEMO_BOLETO"
  | "DEMO_PIX";

export type DemoPaymentInstrument = Readonly<{
  instrumentRef: string;
  acceptanceRef: string;
  type: DemoPaymentInstrumentType;
  displayValue: string;
  expiresAt: string;
  isDemo: true;
  warning: "DEMONSTRAÇÃO — SEM VALOR FINANCEIRO";
}>;

export type PaymentStatus = Readonly<{
  debtRef: string;
  status: "OPEN" | "PENDING_CONFIRMATION" | "PAID";
  updatedAt: string;
}>;

export type PaymentPromiseInput = Readonly<{
  idempotencyKey: string;
  debtRef: string;
  offerRef?: string;
  promisedDate: string;
}>;

export type PaymentPromiseResult = Readonly<{
  providerReference: string;
  debtRef: string;
  promisedDate: string;
  status: "RECORDED";
}>;

export type PaymentReportInput = Readonly<{
  idempotencyKey: string;
  debtRef: string;
  reportedAt: string;
}>;

export type PaymentReportResult = Readonly<{
  providerReference: string;
  debtRef: string;
  status: "PENDING_REVIEW";
}>;

export type DisputeInput = Readonly<{
  idempotencyKey: string;
  debtRef: string;
  reasonCode: "NOT_RECOGNIZED" | "AMOUNT_INCORRECT" | "ALREADY_PAID" | "OTHER";
  description?: string;
}>;

export type DisputeResult = Readonly<{
  providerReference: string;
  debtRef: string;
  status: "PENDING_REVIEW";
}>;

