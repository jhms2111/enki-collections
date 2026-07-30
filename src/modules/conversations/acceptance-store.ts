import type { OfferTerms } from "@/modules/debt-provider/debt-provider.types";

import type {
  AcceptanceResponse,
  InstrumentResponse,
} from "./acceptance.schemas";
import type { AuditInput, PersistedConversation } from "./persistence.types";

export type PersistedOfferAcceptance = Readonly<{
  id: string;
  organizationId: string;
  conversationId: string;
  publicReference: string;
  debtRef: string;
  offerRef: string;
  providerAcceptanceRef: string;
  providerVersion: string;
  termsSnapshot: OfferTerms;
  acceptedAt: Date;
}>;

export type IdempotencyScope = Readonly<{
  organizationId: string;
  operation:
    | "ACCEPT_OFFER"
    | "CREATE_PAYMENT_INSTRUMENT"
    | "REGISTER_PAYMENT_PROMISE"
    | "REPORT_PAYMENT"
    | "OPEN_DISPUTE";
  resourceRef: string;
  keyHash: string;
  requestFingerprint: string;
}>;

export interface AcceptanceStore {
  findAcceptanceResult(
    scope: IdempotencyScope,
  ): Promise<AcceptanceResponse | null>;

  finalizeAcceptance(input: {
    scope: IdempotencyScope;
    conversation: PersistedConversation;
    acceptance: PersistedOfferAcceptance;
    response: AcceptanceResponse;
    audit: AuditInput;
  }): Promise<AcceptanceResponse>;

  findAcceptance(
    conversation: PersistedConversation,
    publicReference: string,
  ): Promise<PersistedOfferAcceptance | null>;

  findInstrumentResult(
    scope: IdempotencyScope,
  ): Promise<InstrumentResponse | null>;

  finalizeInstrument(input: {
    scope: IdempotencyScope;
    conversation: PersistedConversation;
    response: InstrumentResponse;
    audit: AuditInput;
    expiresAt: Date;
  }): Promise<InstrumentResponse>;
}
