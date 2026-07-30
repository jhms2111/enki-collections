import { randomUUID } from "node:crypto";

import type { DebtProvider } from "@/modules/debt-provider/debt-provider";
import type {
  DemoPaymentInstrument,
  OfferTerms,
  VerifiedDebtorContext,
} from "@/modules/debt-provider/debt-provider.types";
import type { OrganizationContext } from "@/modules/organizations/organization-context";
import { hashSessionToken } from "@/shared/auth/session-token";
import { ApplicationError } from "@/shared/errors/application-error";
import {
  deriveProviderIdempotencyKey,
  fingerprintPayload,
  hashIdempotencyKey,
} from "@/shared/idempotency/idempotency";

import type {
  AcceptanceResponse,
  InstrumentResponse,
} from "./acceptance.schemas";
import type {
  AcceptanceStore,
  IdempotencyScope,
} from "./acceptance-store";
import type { ConversationStore } from "./conversation-store";
import { verifiedDebtorContextSchema } from "./debt.schemas";
import type { PersistedConversation } from "./persistence.types";

type AcceptOfferRequest = Readonly<{
  confirmation: true;
  expectedProviderVersion: string;
  expectedTerms: OfferTerms;
}>;

export class OfferAcceptanceService {
  constructor(
    private readonly conversationStore: ConversationStore,
    private readonly acceptanceStore: AcceptanceStore,
    private readonly debtProvider: DebtProvider,
    private readonly sessionSecret: string,
    private readonly idempotencySecret: string,
    private readonly sessionMaxAgeSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async acceptOffer(input: {
    publicReference: string;
    token: string | undefined;
    debtRef: string;
    offerRef: string;
    idempotencyKey: string;
    request: AcceptOfferRequest;
    requestId: string;
  }): Promise<AcceptanceResponse> {
    const conversation = await this.authenticate(
      input.publicReference,
      input.token,
    );
    const debtor = this.requireVerifiedContext(conversation);
    const resourceRef = `${conversation.id}:${input.debtRef}:${input.offerRef}`;
    const scope = this.createScope({
      conversation,
      operation: "ACCEPT_OFFER",
      resourceRef,
      idempotencyKey: input.idempotencyKey,
      payload: {
        debtRef: input.debtRef,
        offerRef: input.offerRef,
        ...input.request,
      },
    });
    const existing = await this.acceptanceStore.findAcceptanceResult(scope);
    if (existing) {
      return existing;
    }

    const organization = this.organizationContext(
      conversation,
      input.requestId,
    );
    const currentOffer = await this.debtProvider.getAuthorizedOffer(
      organization,
      debtor,
      input.offerRef,
    );
    if (currentOffer.debtRef !== input.debtRef) {
      throw new ApplicationError(
        "OFFER_NOT_FOUND",
        "Proposta não encontrada para esta dívida.",
        404,
      );
    }

    const acceptedAt = this.now();
    const providerResult = await this.debtProvider.acceptOffer(
      organization,
      debtor,
      {
        idempotencyKey: this.providerKey(scope),
        offerRef: input.offerRef,
        expectedProviderVersion: input.request.expectedProviderVersion,
        expectedTerms: input.request.expectedTerms,
        acceptedAt: acceptedAt.toISOString(),
      },
    );
    const publicAcceptanceReference = `accept_${randomUUID().replaceAll("-", "")}`;
    const response: AcceptanceResponse = {
      acceptance: {
        id: publicAcceptanceReference,
        debtRef: input.debtRef,
        offerRef: input.offerRef,
        providerVersion: providerResult.providerVersion,
        acceptedAt: providerResult.acceptedAt,
      },
    };

    return this.acceptanceStore.finalizeAcceptance({
      scope,
      conversation,
      acceptance: {
        id: `acceptance_${randomUUID().replaceAll("-", "")}`,
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        publicReference: publicAcceptanceReference,
        debtRef: input.debtRef,
        offerRef: input.offerRef,
        providerAcceptanceRef: providerResult.acceptanceRef,
        providerVersion: providerResult.providerVersion,
        termsSnapshot: currentOffer.terms,
        acceptedAt: new Date(providerResult.acceptedAt),
      },
      response,
      audit: {
        eventType: "OFFER_ACCEPTED",
        actor: "DEBTOR",
        entityType: "OFFER_ACCEPTANCE",
        entityRef: publicAcceptanceReference,
        metadata: {
          debtRef: input.debtRef,
          offerRef: input.offerRef,
          providerVersion: providerResult.providerVersion,
        },
        occurredAt: acceptedAt,
      },
    });
  }

  async createInstrument(input: {
    publicReference: string;
    token: string | undefined;
    acceptanceReference: string;
    type: "DEMO_LINK" | "DEMO_BOLETO" | "DEMO_PIX";
    idempotencyKey: string;
    requestId: string;
  }): Promise<InstrumentResponse> {
    const conversation = await this.authenticate(
      input.publicReference,
      input.token,
    );
    const debtor = this.requireVerifiedContext(conversation);
    const acceptance = await this.acceptanceStore.findAcceptance(
      conversation,
      input.acceptanceReference,
    );
    if (!acceptance) {
      throw new ApplicationError(
        "ACCEPTANCE_NOT_FOUND",
        "Aceite não encontrado.",
        404,
      );
    }

    const resourceRef = `${conversation.id}:${acceptance.id}:${input.type}`;
    const scope = this.createScope({
      conversation,
      operation: "CREATE_PAYMENT_INSTRUMENT",
      resourceRef,
      idempotencyKey: input.idempotencyKey,
      payload: {
        acceptanceReference: input.acceptanceReference,
        type: input.type,
      },
    });
    const existing = await this.acceptanceStore.findInstrumentResult(scope);
    if (existing) {
      return existing;
    }

    const instrument = await this.debtProvider.createPaymentInstrument(
      this.organizationContext(conversation, input.requestId),
      debtor,
      {
        idempotencyKey: this.providerKey(scope),
        acceptanceRef: acceptance.providerAcceptanceRef,
        type: input.type,
      },
    );
    this.assertNonPayableInstrument(instrument);

    const response: InstrumentResponse = {
      instrument: {
        type: instrument.type,
        displayValue: instrument.displayValue,
        expiresAt: instrument.expiresAt,
        isDemo: true,
        warning: "DEMONSTRAÇÃO — SEM VALOR FINANCEIRO",
      },
    };
    return this.acceptanceStore.finalizeInstrument({
      scope,
      conversation,
      response,
      expiresAt: new Date(instrument.expiresAt),
      audit: {
        eventType: "DEMO_PAYMENT_INSTRUMENT_CREATED",
        actor: "DEBTOR",
        entityType: "OFFER_ACCEPTANCE",
        entityRef: acceptance.publicReference,
        metadata: { instrumentType: input.type },
        occurredAt: this.now(),
      },
    });
  }

  private async authenticate(
    publicReference: string,
    token: string | undefined,
  ): Promise<PersistedConversation> {
    if (!token) {
      throw new ApplicationError(
        "SESSION_REQUIRED",
        "Sessão válida obrigatória.",
        401,
      );
    }
    const conversation =
      await this.conversationStore.authenticateConversation(
        publicReference,
        hashSessionToken(token, this.sessionSecret),
        new Date(
          this.now().getTime() - this.sessionMaxAgeSeconds * 1_000,
        ),
      );
    if (!conversation) {
      throw new ApplicationError(
        "SESSION_INVALID",
        "Sessão inválida.",
        401,
      );
    }
    return conversation;
  }

  private requireVerifiedContext(
    conversation: PersistedConversation,
  ): VerifiedDebtorContext {
    if (conversation.optedOutAt || conversation.state === "OPTED_OUT") {
      throw new ApplicationError(
        "MESSAGING_OPTED_OUT",
        "A sessão não permite novas negociações.",
        409,
      );
    }
    if (
      conversation.identityStatus !== "VERIFIED" ||
      !["IDENTITY_VERIFIED", "OFFER_ACCEPTED"].includes(
        conversation.state,
      ) ||
      !conversation.verifiedDebtorContext
    ) {
      throw new ApplicationError(
        "IDENTITY_VERIFICATION_REQUIRED",
        "Validação de identidade obrigatória.",
        403,
      );
    }
    return verifiedDebtorContextSchema.parse(
      conversation.verifiedDebtorContext,
    );
  }

  private createScope(input: {
    conversation: PersistedConversation;
    operation: IdempotencyScope["operation"];
    resourceRef: string;
    idempotencyKey: string;
    payload: unknown;
  }): IdempotencyScope {
    return {
      organizationId: input.conversation.organizationId,
      operation: input.operation,
      resourceRef: input.resourceRef,
      keyHash: hashIdempotencyKey(
        input.idempotencyKey,
        this.idempotencySecret,
      ),
      requestFingerprint: fingerprintPayload(input.payload),
    };
  }

  private providerKey(scope: IdempotencyScope): string {
    return deriveProviderIdempotencyKey({
      organizationId: scope.organizationId,
      operation: scope.operation,
      resourceRef: scope.resourceRef,
      keyHash: scope.keyHash,
      secret: this.idempotencySecret,
    });
  }

  private organizationContext(
    conversation: PersistedConversation,
    requestId: string,
  ): OrganizationContext {
    return {
      organizationId: conversation.organizationId,
      requestId,
    };
  }

  private assertNonPayableInstrument(
    instrument: DemoPaymentInstrument,
  ): void {
    const invalid =
      !instrument.isDemo ||
      instrument.warning !== "DEMONSTRAÇÃO — SEM VALOR FINANCEIRO" ||
      (instrument.type === "DEMO_LINK" &&
        (!instrument.displayValue.startsWith("/demo/") ||
          /^https?:\/\//i.test(instrument.displayValue))) ||
      (instrument.type === "DEMO_BOLETO" &&
        (/^\d{44,48}$/.test(instrument.displayValue) ||
          !instrument.displayValue.includes("DEMO"))) ||
      (instrument.type === "DEMO_PIX" &&
        (instrument.displayValue.startsWith("000201") ||
          !instrument.displayValue.startsWith("PIX-DEMO-")));
    if (invalid) {
      throw new ApplicationError(
        "UNSAFE_DEMO_INSTRUMENT",
        "O provider retornou um instrumento demonstrativo inválido.",
        502,
      );
    }
  }
}
