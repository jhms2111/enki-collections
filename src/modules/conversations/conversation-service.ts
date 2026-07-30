import type { DebtProvider } from "@/modules/debt-provider/debt-provider";
import type {
  AuthorizedOffer,
  DebtDetails,
  DebtSummary,
  VerifiedDebtorContext,
} from "@/modules/debt-provider/debt-provider.types";
import type { OrganizationContext } from "@/modules/organizations/organization-context";
import {
  generatePublicReference,
  generateSessionToken,
  hashSessionToken,
} from "@/shared/auth/session-token";
import { ApplicationError } from "@/shared/errors/application-error";

import type { ConversationStore } from "./conversation-store";
import { toPublicConversationDto } from "./conversation.dto";
import type { PersistedConversation } from "./persistence.types";
import {
  presentAuthorizedOffers,
  presentDebtDetails,
  presentGroupedDebts,
} from "./debt.dto";
import { verifiedDebtorContextSchema } from "./debt.schemas";

export class ConversationService {
  constructor(
    private readonly store: ConversationStore,
    private readonly debtProvider: DebtProvider,
    private readonly sessionSecret: string,
    private readonly maxIdentityAttempts: number,
    private readonly sessionMaxAgeSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async create(slug: string) {
    const organization =
      await this.store.findActiveOrganizationBySlug(slug);
    if (!organization) {
      throw new ApplicationError(
        "ORGANIZATION_NOT_FOUND",
        "Organização não encontrada.",
        404,
      );
    }

    const token = generateSessionToken();
    const now = this.now();
    const conversation = await this.store.createConversation({
      organization,
      publicReference: generatePublicReference(),
      sessionTokenHash: hashSessionToken(token, this.sessionSecret),
      now,
      welcomeMessage:
        "Demonstração com dados inteiramente fictícios. Nenhum pagamento real será processado.",
      audit: {
        eventType: "CONVERSATION_CREATED",
        actor: "SYSTEM",
        metadata: { channel: "WEBCHAT" },
        occurredAt: now,
      },
    });

    return {
      token,
      conversation: toPublicConversationDto(conversation),
    };
  }

  async get(publicReference: string, token: string | undefined) {
    const conversation = await this.authenticate(publicReference, token);
    return toPublicConversationDto(conversation);
  }

  async identify(
    publicReference: string,
    token: string | undefined,
    demoIdentifier: string,
    requestId: string,
  ) {
    const conversation = await this.authenticate(publicReference, token);
    this.assertNegotiationAllowed(conversation);

    if (
      conversation.identityStatus === "VERIFIED" ||
      conversation.identityStatus === "BLOCKED"
    ) {
      throw new ApplicationError(
        "IDENTITY_STATE_INVALID",
        "A identificação não pode ser reiniciada nesta sessão.",
        409,
      );
    }

    const organization = this.organizationContext(conversation, requestId);
    const identification = await this.debtProvider.identifyDebtor(
      organization,
      { type: "DEMO_ID", value: demoIdentifier },
    );
    if (!identification) {
      throw new ApplicationError(
        "DEMO_DEBTOR_NOT_FOUND",
        "Identificador demonstrativo não encontrado.",
        404,
      );
    }

    const now = this.now();
    const updated = await this.store.recordIdentification({
      conversation,
      identificationRef: identification.identificationRef,
      now,
      audit: {
        eventType: "DEMO_DEBTOR_IDENTIFIED",
        actor: "DEBTOR",
        entityType: "DEMO_DEBTOR",
        metadata: { identifierType: "DEMO_ID" },
        occurredAt: now,
      },
    });

    return {
      conversation: toPublicConversationDto(updated),
      verificationRequired: true as const,
    };
  }

  async verifyIdentity(
    publicReference: string,
    token: string | undefined,
    optionRef: string,
    requestId: string,
  ) {
    const conversation = await this.authenticate(publicReference, token);
    this.assertNegotiationAllowed(conversation);

    if (
      conversation.identityStatus === "BLOCKED" ||
      conversation.state === "IDENTITY_BLOCKED"
    ) {
      throw new ApplicationError(
        "IDENTITY_LOCKED",
        "A sessão está bloqueada para novas tentativas.",
        423,
      );
    }
    if (
      conversation.identityStatus !== "PENDING" ||
      !conversation.debtorRef
    ) {
      throw new ApplicationError(
        "IDENTITY_NOT_STARTED",
        "A identificação demonstrativa ainda não foi iniciada.",
        409,
      );
    }

    const organization = this.organizationContext(conversation, requestId);
    const challenge = await this.debtProvider.getIdentityChallenge(
      organization,
      conversation.debtorRef,
    );
    const verification = await this.debtProvider.verifyIdentity(
      organization,
      conversation.debtorRef,
      challenge.challengeRef,
      optionRef,
    );
    const verifiedDebtorRef = verification.verified
      ? verification.debtorContext.authorizedAccounts[0]?.debtorRef
      : undefined;
    if (verification.verified && !verifiedDebtorRef) {
      throw new Error("Provider retornou contexto verificado sem devedor.");
    }

    const now = this.now();
    const updated = await this.store.recordIdentityAttempt({
      conversation,
      verified: verification.verified,
      verifiedDebtorRef,
      verifiedDebtorContext: verification.verified
        ? verification.debtorContext
        : undefined,
      maxAttempts: this.maxIdentityAttempts,
      now,
      audit: {
        eventType: verification.verified
          ? "IDENTITY_VERIFIED"
          : "IDENTITY_VERIFICATION_FAILED",
        actor: "DEBTOR",
        entityType: "DEMO_DEBTOR",
        metadata: { verified: verification.verified },
        occurredAt: now,
      },
    });

    return {
      conversation: toPublicConversationDto(updated),
      verified: verification.verified,
      attemptsRemaining: verification.verified
        ? this.maxIdentityAttempts - updated.failedIdentityAttempts
        : Math.max(
            this.maxIdentityAttempts - updated.failedIdentityAttempts,
            0,
          ),
    };
  }

  async listDebts(
    publicReference: string,
    token: string | undefined,
    requestId: string,
  ) {
    const conversation = await this.authenticate(publicReference, token);
    const debtor = this.requireVerifiedContext(conversation);
    const organization = this.organizationContext(conversation, requestId);
    const debts: readonly DebtSummary[] = await this.debtProvider.listDebts(
      organization,
      debtor,
    );
    await this.auditFinancialRead(
      conversation,
      "DEBTS_LISTED",
      { debtCount: debts.length },
    );
    return presentGroupedDebts(debts);
  }

  async getDebt(
    publicReference: string,
    token: string | undefined,
    debtRef: string,
    requestId: string,
  ) {
    const conversation = await this.authenticate(publicReference, token);
    const debtor = this.requireVerifiedContext(conversation);
    const organization = this.organizationContext(conversation, requestId);
    const debt: DebtDetails = await this.debtProvider.getDebt(
      organization,
      debtor,
      debtRef,
    );
    await this.auditFinancialRead(conversation, "DEBT_VIEWED", {
      debtRef,
    });
    return presentDebtDetails(debt);
  }

  async listAuthorizedOffers(
    publicReference: string,
    token: string | undefined,
    debtRef: string,
    requestId: string,
  ) {
    const conversation = await this.authenticate(publicReference, token);
    const debtor = this.requireVerifiedContext(conversation);
    const organization = this.organizationContext(conversation, requestId);
    const offers: readonly AuthorizedOffer[] =
      await this.debtProvider.listAuthorizedOffers(
        organization,
        debtor,
        debtRef,
      );
    await this.auditFinancialRead(conversation, "AUTHORIZED_OFFERS_LISTED", {
      debtRef,
      offerCount: offers.length,
    });
    return presentAuthorizedOffers(offers, this.now());
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

    const conversation = await this.store.authenticateConversation(
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

  private assertNegotiationAllowed(
    conversation: PersistedConversation,
  ): void {
    if (conversation.optedOutAt || conversation.state === "OPTED_OUT") {
      throw new ApplicationError(
        "MESSAGING_OPTED_OUT",
        "A sessão não permite novas negociações.",
        409,
      );
    }
    if (conversation.state === "IDENTITY_BLOCKED") {
      throw new ApplicationError(
        "IDENTITY_LOCKED",
        "A sessão está bloqueada para novas tentativas.",
        423,
      );
    }
  }

  private requireVerifiedContext(
    conversation: PersistedConversation,
  ): VerifiedDebtorContext {
    this.assertNegotiationAllowed(conversation);
    if (
      conversation.identityStatus !== "VERIFIED" ||
      conversation.state !== "IDENTITY_VERIFIED" ||
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

  private async auditFinancialRead(
    conversation: PersistedConversation,
    eventType: string,
    metadata: Readonly<Record<string, string | number>>,
  ): Promise<void> {
    await this.store.recordAudit({
      conversation,
      audit: {
        eventType,
        actor: "DEBTOR",
        metadata,
        occurredAt: this.now(),
      },
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
}
