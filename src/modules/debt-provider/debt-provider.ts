import type { OrganizationContext } from "@/modules/organizations/organization-context";

import type {
  AuthorizedOffer,
  DebtDetails,
  DebtSummary,
  DemoDebtorIdentifier,
  DemoPaymentInstrument,
  DemoPaymentInstrumentType,
  DisputeInput,
  DisputeResult,
  IdentityChallenge,
  IdentityVerification,
  OfferAcceptanceInput,
  OfferAcceptanceResult,
  PaymentPromiseInput,
  PaymentPromiseResult,
  PaymentReportInput,
  PaymentReportResult,
  PaymentStatus,
  VerifiedDebtorContext,
  DebtorIdentification,
} from "./debt-provider.types";

export interface DebtProvider {
  identifyDebtor(
    organization: OrganizationContext,
    identifier: DemoDebtorIdentifier,
  ): Promise<DebtorIdentification | null>;

  getIdentityChallenge(
    organization: OrganizationContext,
    identificationRef: string,
  ): Promise<IdentityChallenge>;

  verifyIdentity(
    organization: OrganizationContext,
    identificationRef: string,
    challengeRef: string,
    optionRef: string,
  ): Promise<IdentityVerification>;

  listDebts(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
  ): Promise<readonly DebtSummary[]>;

  getDebt(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    debtRef: string,
  ): Promise<DebtDetails>;

  listAuthorizedOffers(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    debtRef: string,
  ): Promise<readonly AuthorizedOffer[]>;

  getAuthorizedOffer(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    offerRef: string,
  ): Promise<AuthorizedOffer>;

  acceptOffer(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: OfferAcceptanceInput,
  ): Promise<OfferAcceptanceResult>;

  createPaymentInstrument(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: Readonly<{
      idempotencyKey: string;
      acceptanceRef: string;
      type: DemoPaymentInstrumentType;
    }>,
  ): Promise<DemoPaymentInstrument>;

  getPaymentStatus(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    debtRef: string,
  ): Promise<PaymentStatus>;

  registerPaymentPromise(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: PaymentPromiseInput,
  ): Promise<PaymentPromiseResult>;

  reportPayment(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: PaymentReportInput,
  ): Promise<PaymentReportResult>;

  openDispute(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: DisputeInput,
  ): Promise<DisputeResult>;
}

