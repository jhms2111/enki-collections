import { randomUUID } from "node:crypto";

import type { DebtProvider } from "@/modules/debt-provider/debt-provider";
import type { VerifiedDebtorContext } from "@/modules/debt-provider/debt-provider.types";
import type { OrganizationContext } from "@/modules/organizations/organization-context";
import { hashSessionToken } from "@/shared/auth/session-token";
import { ApplicationError } from "@/shared/errors/application-error";
import {
  deriveProviderIdempotencyKey,
  fingerprintPayload,
  hashIdempotencyKey,
} from "@/shared/idempotency/idempotency";

import type { IdempotencyScope } from "./acceptance-store";
import type { ConversationStore } from "./conversation-store";
import { verifiedDebtorContextSchema } from "./debt.schemas";
import type { OccurrenceStore } from "./occurrence-store";
import type {
  DisputeResponse,
  PaymentPromiseResponse,
  PaymentReportResponse,
} from "./occurrence.schemas";
import type { PersistedConversation } from "./persistence.types";

export class OccurrenceService {
  constructor(
    private readonly conversationStore: ConversationStore,
    private readonly occurrenceStore: OccurrenceStore,
    private readonly debtProvider: DebtProvider,
    private readonly sessionSecret: string,
    private readonly idempotencySecret: string,
    private readonly sessionMaxAgeSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async registerPaymentPromise(input: {
    publicReference: string;
    token?: string;
    debtRef: string;
    idempotencyKey: string;
    request: { promisedDate: string; offerRef?: string };
    requestId: string;
  }): Promise<PaymentPromiseResponse> {
    const { conversation, debtor } = await this.authorize(input);
    this.assertTimeZone(conversation.organizationTimeZone);
    const scope = this.scope(
      conversation,
      "REGISTER_PAYMENT_PROMISE",
      `${conversation.id}:${input.debtRef}`,
      input.idempotencyKey,
      { debtRef: input.debtRef, ...input.request },
    );
    const existing = await this.occurrenceStore.findResult(scope);
    if (existing) return existing as PaymentPromiseResponse;

    const result = await this.debtProvider.registerPaymentPromise(
      this.organization(conversation, input.requestId),
      debtor,
      {
        idempotencyKey: this.providerKey(scope),
        debtRef: input.debtRef,
        offerRef: input.request.offerRef,
        promisedDate: input.request.promisedDate,
      },
    );
    const publicReference = `promise_${randomUUID().replaceAll("-", "")}`;
    const response: PaymentPromiseResponse = {
      promise: {
        id: publicReference,
        debtRef: result.debtRef,
        promisedDate: result.promisedDate,
        status: "RECORDED",
      },
    };
    return (await this.occurrenceStore.finalize({
      scope,
      conversation,
      occurrence: {
        kind: "PAYMENT_PROMISE",
        id: `payment_promise_${randomUUID().replaceAll("-", "")}`,
        publicReference,
        providerReference: result.providerReference,
        debtRef: result.debtRef,
        offerRef: input.request.offerRef,
        promisedDate: new Date(`${result.promisedDate}T00:00:00.000Z`),
        timeZone: conversation.organizationTimeZone,
        status: "RECORDED",
      },
      response,
      audit: {
        eventType: "PAYMENT_PROMISE_RECORDED",
        actor: "DEBTOR",
        entityType: "PAYMENT_PROMISE",
        entityRef: publicReference,
        metadata: {
          debtRef: result.debtRef,
          promisedDate: result.promisedDate,
          timeZone: conversation.organizationTimeZone,
          status: "RECORDED",
        },
        occurredAt: this.now(),
      },
    })) as PaymentPromiseResponse;
  }

  async reportPayment(input: {
    publicReference: string;
    token?: string;
    debtRef: string;
    idempotencyKey: string;
    request: { reportedAt: string };
    requestId: string;
  }): Promise<PaymentReportResponse> {
    const { conversation, debtor } = await this.authorize(input);
    const scope = this.scope(
      conversation,
      "REPORT_PAYMENT",
      `${conversation.id}:${input.debtRef}`,
      input.idempotencyKey,
      { debtRef: input.debtRef, reportedAt: input.request.reportedAt },
    );
    const existing = await this.occurrenceStore.findResult(scope);
    if (existing) return existing as PaymentReportResponse;

    const result = await this.debtProvider.reportPayment(
      this.organization(conversation, input.requestId),
      debtor,
      {
        idempotencyKey: this.providerKey(scope),
        debtRef: input.debtRef,
        reportedAt: input.request.reportedAt,
      },
    );
    const receivedAt = this.now();
    const publicReference = `report_${randomUUID().replaceAll("-", "")}`;
    const response: PaymentReportResponse = {
      report: {
        id: publicReference,
        debtRef: result.debtRef,
        reportedAt: input.request.reportedAt,
        receivedAt: receivedAt.toISOString(),
        status: "PENDING_REVIEW",
        warning: "PAGAMENTO INFORMADO — NÃO CONFIRMADO",
      },
    };
    return (await this.occurrenceStore.finalize({
      scope,
      conversation,
      occurrence: {
        kind: "PAYMENT_REPORT",
        id: `payment_report_${randomUUID().replaceAll("-", "")}`,
        publicReference,
        providerReference: result.providerReference,
        debtRef: result.debtRef,
        reportedAt: new Date(input.request.reportedAt),
        receivedAt,
        status: "PENDING_REVIEW",
      },
      response,
      audit: {
        eventType: "PAYMENT_REPORTED",
        actor: "DEBTOR",
        entityType: "PAYMENT_REPORT",
        entityRef: publicReference,
        metadata: {
          debtRef: result.debtRef,
          reportedAt: input.request.reportedAt,
          receivedAt: receivedAt.toISOString(),
          status: "PENDING_REVIEW",
          confirmed: false,
        },
        occurredAt: receivedAt,
      },
    })) as PaymentReportResponse;
  }

  async openDispute(input: {
    publicReference: string;
    token?: string;
    debtRef: string;
    idempotencyKey: string;
    request: {
      reasonCode: "NOT_RECOGNIZED" | "AMOUNT_INCORRECT" | "ALREADY_PAID" | "OTHER";
      description?: string;
    };
    requestId: string;
  }): Promise<DisputeResponse> {
    const { conversation, debtor } = await this.authorize(input);
    const scope = this.scope(
      conversation,
      "OPEN_DISPUTE",
      `${conversation.id}:${input.debtRef}`,
      input.idempotencyKey,
      { debtRef: input.debtRef, ...input.request },
    );
    const existing = await this.occurrenceStore.findResult(scope);
    if (existing) return existing as DisputeResponse;

    const result = await this.debtProvider.openDispute(
      this.organization(conversation, input.requestId),
      debtor,
      {
        idempotencyKey: this.providerKey(scope),
        debtRef: input.debtRef,
        reasonCode: input.request.reasonCode,
        description: input.request.description,
      },
    );
    const publicReference = `dispute_${randomUUID().replaceAll("-", "")}`;
    const response: DisputeResponse = {
      dispute: {
        id: publicReference,
        debtRef: result.debtRef,
        reasonCode: input.request.reasonCode,
        status: "PENDING_REVIEW",
      },
    };
    return (await this.occurrenceStore.finalize({
      scope,
      conversation,
      occurrence: {
        kind: "DISPUTE",
        id: `dispute_record_${randomUUID().replaceAll("-", "")}`,
        publicReference,
        providerReference: result.providerReference,
        debtRef: result.debtRef,
        reasonCode: input.request.reasonCode,
        description: input.request.description,
        status: "PENDING_REVIEW",
      },
      response,
      audit: {
        eventType: "DISPUTE_OPENED",
        actor: "DEBTOR",
        entityType: "DISPUTE",
        entityRef: publicReference,
        metadata: {
          debtRef: result.debtRef,
          reasonCode: input.request.reasonCode,
          hasDescription: Boolean(input.request.description),
          status: "PENDING_REVIEW",
        },
        occurredAt: this.now(),
      },
    })) as DisputeResponse;
  }

  private async authorize(input: {
    publicReference: string;
    token?: string;
  }): Promise<{
    conversation: PersistedConversation;
    debtor: VerifiedDebtorContext;
  }> {
    if (!input.token) {
      throw new ApplicationError("SESSION_REQUIRED", "Sessão válida obrigatória.", 401);
    }
    const conversation = await this.conversationStore.authenticateConversation(
      input.publicReference,
      hashSessionToken(input.token, this.sessionSecret),
      new Date(this.now().getTime() - this.sessionMaxAgeSeconds * 1_000),
    );
    if (!conversation) {
      throw new ApplicationError("SESSION_INVALID", "Sessão inválida.", 401);
    }
    if (conversation.optedOutAt || conversation.state === "OPTED_OUT") {
      throw new ApplicationError(
        "MESSAGING_OPTED_OUT",
        "A sessão não permite novas negociações.",
        409,
      );
    }
    if (
      conversation.identityStatus !== "VERIFIED" ||
      !["IDENTITY_VERIFIED", "OFFER_ACCEPTED"].includes(conversation.state) ||
      !conversation.verifiedDebtorContext
    ) {
      throw new ApplicationError(
        "IDENTITY_VERIFICATION_REQUIRED",
        "Validação de identidade obrigatória.",
        403,
      );
    }
    return {
      conversation,
      debtor: verifiedDebtorContextSchema.parse(
        conversation.verifiedDebtorContext,
      ),
    };
  }

  private scope(
    conversation: PersistedConversation,
    operation: IdempotencyScope["operation"],
    resourceRef: string,
    key: string,
    payload: unknown,
  ): IdempotencyScope {
    return {
      organizationId: conversation.organizationId,
      operation,
      resourceRef,
      keyHash: hashIdempotencyKey(key, this.idempotencySecret),
      requestFingerprint: fingerprintPayload(payload),
    };
  }

  private providerKey(scope: IdempotencyScope): string {
    return deriveProviderIdempotencyKey({ ...scope, secret: this.idempotencySecret });
  }

  private organization(
    conversation: PersistedConversation,
    requestId: string,
  ): OrganizationContext {
    return { organizationId: conversation.organizationId, requestId };
  }

  private assertTimeZone(timeZone: string): void {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone }).format(this.now());
    } catch {
      throw new ApplicationError(
        "ORGANIZATION_TIME_ZONE_INVALID",
        "O fuso horário da organização é inválido.",
        500,
      );
    }
  }
}
