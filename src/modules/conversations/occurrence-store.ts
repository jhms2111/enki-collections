import type { IdempotencyScope } from "./acceptance-store";
import type {
  DisputeResponse,
  PaymentPromiseResponse,
  PaymentReportResponse,
} from "./occurrence.schemas";
import type { AuditInput, PersistedConversation } from "./persistence.types";

export type OccurrenceResponse =
  | PaymentPromiseResponse
  | PaymentReportResponse
  | DisputeResponse;

export type OccurrenceRecord =
  | Readonly<{
      kind: "PAYMENT_PROMISE";
      id: string;
      publicReference: string;
      providerReference: string;
      debtRef: string;
      offerRef?: string;
      promisedDate: Date;
      timeZone: string;
      status: "RECORDED";
    }>
  | Readonly<{
      kind: "PAYMENT_REPORT";
      id: string;
      publicReference: string;
      providerReference: string;
      debtRef: string;
      reportedAt: Date;
      receivedAt: Date;
      status: "PENDING_REVIEW";
    }>
  | Readonly<{
      kind: "DISPUTE";
      id: string;
      publicReference: string;
      providerReference: string;
      debtRef: string;
      reasonCode:
        | "NOT_RECOGNIZED"
        | "AMOUNT_INCORRECT"
        | "ALREADY_PAID"
        | "OTHER";
      description?: string;
      status: "PENDING_REVIEW";
    }>;

export interface OccurrenceStore {
  findResult(scope: IdempotencyScope): Promise<OccurrenceResponse | null>;
  finalize(input: {
    scope: IdempotencyScope;
    conversation: PersistedConversation;
    occurrence: OccurrenceRecord;
    response: OccurrenceResponse;
    audit: AuditInput;
  }): Promise<OccurrenceResponse>;
}
