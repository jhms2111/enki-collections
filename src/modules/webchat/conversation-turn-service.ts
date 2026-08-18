import type { ConversationStore } from "@/modules/conversations/conversation-store";
import { verifiedDebtorContextSchema } from "@/modules/conversations/debt.schemas";
import type { PersistedConversation } from "@/modules/conversations/persistence.types";
import type { DebtProvider } from "@/modules/debt-provider/debt-provider";
import { hashSessionToken } from "@/shared/auth/session-token";
import { ApplicationError } from "@/shared/errors/application-error";

import { deriveAiOperationalIdentity, estimateOpenAiCostMicrousd, fingerprintAiTurn, usdToMicrousd } from "./ai-operational-identity";
import type { AiOperationalStore, AiPublicResponse, AiReservationResult } from "./ai-operational-store";
import type { ConversationUiContext } from "./conversation-turn.types";
import { ConversationTurnOrchestrator } from "./conversation-turn-orchestrator";
import { buildDebtCanonicalFacts, buildOfferCanonicalFacts } from "./canonical-turn-context";
import type { CanonicalFact } from "./conversation-turn.types";
import type { OfferPresentation, OfferPresentationPolicy } from "./offer-presentation-policy";
import type { ConversationalIntent } from "./conversation-turn.types";
import { normalizeConversationalText, requestsExplanation } from "./normalize-conversational-text";
import { interpretSafeChatText } from "./deterministic-intent";
import { resolveInstitutionalQuestion } from "./institutional-knowledge";

type CanonicalTurnContext = Readonly<{
  facts: readonly CanonicalFact[];
  offerPresentation?: OfferPresentation;
}>;

type AiRuntimeConfig = Readonly<{
  enabled: boolean;
  model: string;
  safetyHmacSecret?: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  maxCallsPerConversation: number;
  dailyBudgetUsd: number;
  monthlyBudgetUsd: number;
  circuitFailureThreshold: number;
  circuitOpenSeconds: number;
  reservationTtlMs: number;
}>;

export class ConversationTurnService {
  constructor(
    private readonly store: ConversationStore,
    private readonly orchestrator: ConversationTurnOrchestrator,
    private readonly sessionSecret: string,
    private readonly sessionMaxAgeSeconds: number,
    private readonly now: () => Date = () => new Date(),
    private readonly aiStore?: AiOperationalStore,
    private readonly aiConfig: AiRuntimeConfig = {
      enabled: false, model: "gpt-5.6-luna", maxInputTokens: 4_000, maxOutputTokens: 200,
      maxCallsPerConversation: 5, dailyBudgetUsd: 0.5, monthlyBudgetUsd: 5,
      circuitFailureThreshold: 5, circuitOpenSeconds: 60,
      reservationTtlMs: 10_000,
    },
    private readonly debtProvider?: DebtProvider,
    private readonly offerPresentationPolicy?: OfferPresentationPolicy,
  ) {}

  async interpret(input: {
    publicReference: string;
    token?: string;
    message: string;
    clientTurnId: string;
    uiContext: ConversationUiContext;
    requestId?: string;
    selectedDebtRef?: string;
    selectedOfferRef?: string;
  }): Promise<AiPublicResponse> {
    const conversation = await this.authenticate(input.publicReference, input.token);
    const canonicalContext = await this.loadCanonicalContext(conversation, input);
    const canonicalFacts = canonicalContext.facts;
    const lastSubjectRaw = await this.store.findLatestConversationalIntent?.(conversation);
    const lastSubject = lastSubjectRaw ?? undefined;
    const contextualInput = { ...input, lastSubject };
    const deterministicIntent = interpretSafeChatText(input.message);
    if (input.selectedOfferRef && canonicalContext.offerPresentation && requestsExplanation(input.message)) {
      const turn = { intent: "HELP" as const, message: canonicalContext.offerPresentation.publicText, storageMessage: canonicalContext.offerPresentation.replayMarker, suggestedActions: [] as const, requiresConfirmation: false, fallbackUsed: true, fallbackReason: "CANONICAL_OFFER_EXPLANATION" };
      await this.recordSafeAudit(conversation, input.clientTurnId, turn);
      return this.toPublicResponse(turn);
    }
    if (input.selectedDebtRef && !input.selectedOfferRef && requestsExplanation(input.message) && this.requestsOfferExplanation(input.message)) {
      const turn = {
        intent: "LIST_OFFERS" as const,
        message: "Selecione uma proposta para que eu possa explicar as condições.",
        suggestedActions: ["LIST_OFFERS" as const],
        requiresConfirmation: false,
        fallbackUsed: true,
        fallbackReason: "OFFER_CONTEXT_REQUIRED",
      };
      await this.recordSafeAudit(conversation, input.clientTurnId, turn);
      return this.toPublicResponse(turn);
    }
    if (input.selectedOfferRef && !canonicalContext.offerPresentation && requestsExplanation(input.message)) {
      const turn = {
        intent: "LIST_OFFERS" as const,
        message: "Selecione uma proposta para que eu possa explicar as condições.",
        suggestedActions: ["LIST_OFFERS" as const],
        requiresConfirmation: false,
        fallbackUsed: true,
        fallbackReason: "OFFER_PRESENTATION_UNAVAILABLE",
      };
      await this.recordSafeAudit(conversation, input.clientTurnId, turn);
      return this.toPublicResponse(turn);
    }
    if (deterministicIntent === "LIST_OFFERS" && input.selectedDebtRef) {
      const turn = { intent: "LIST_OFFERS" as const, message: "Vou apresentar as propostas previamente autorizadas para esta dívida.", suggestedActions: ["LIST_OFFERS" as const], requiresConfirmation: false, fallbackUsed: true, fallbackReason: "DETERMINISTIC_STATE_ROUTING" };
      await this.recordSafeAudit(conversation, input.clientTurnId, turn);
      return this.toPublicResponse(turn);
    }
    const institutional = resolveInstitutionalQuestion(input.message, {
      identityVerified: conversation.identityStatus === "VERIFIED",
      facts: canonicalFacts,
      lastSubject,
    });
    if (institutional) {
      const intent: ConversationalIntent = institutional.intent ?? "HELP";
      const turn = { intent, message: institutional.message, suggestedActions: [] as const, requiresConfirmation: ["DISPUTE_DEBT", "OPT_OUT", "CLOSE"].includes(intent), fallbackUsed: true, fallbackReason: "INSTITUTIONAL_KNOWLEDGE", subject: institutional.subject, quickReplies: institutional.quickReplies };
      await this.recordSafeAudit(conversation, input.clientTurnId, turn);
      return this.toPublicResponse(turn);
    }
    const preModelTurn = this.orchestrator.handlePreModelGuard({
      channel: "WEBCHAT",
      message: input.message,
      conversationState: conversation.state,
      identityStatus: conversation.identityStatus,
      uiContext: input.uiContext,
      canonicalFacts,
    });
    if (preModelTurn) {
      await this.recordSafeAudit(conversation, input.clientTurnId, preModelTurn);
      return this.toPublicResponse(preModelTurn);
    }
    if (!this.aiConfig.enabled) {
      return (await this.executeAndAudit(conversation, contextualInput, canonicalFacts, undefined, false, false, canonicalContext.offerPresentation)).response;
    }
    if (!this.aiStore || !this.aiConfig.safetyHmacSecret) {
      return (await this.executeAndAudit(conversation, contextualInput, canonicalFacts, undefined, true, false, canonicalContext.offerPresentation)).response;
    }

    const identity = deriveAiOperationalIdentity({
      secret: this.aiConfig.safetyHmacSecret,
      organizationId: conversation.organizationId,
      conversationId: conversation.id,
      clientTurnId: input.clientTurnId,
    });
    const requestFingerprint = fingerprintAiTurn(this.aiConfig.safetyHmacSecret, {
      message: input.message,
      uiContext: input.uiContext,
      conversationState: conversation.state,
      identityStatus: conversation.identityStatus,
      selectedDebtRef: input.selectedDebtRef ?? null,
      selectedOfferRef: input.selectedOfferRef ?? null,
    });
    const deterministicFallback = this.orchestrator.handleDeterministic({
      channel: "WEBCHAT",
      message: input.message,
      conversationState: conversation.state,
      identityStatus: conversation.identityStatus,
      uiContext: input.uiContext,
      canonicalFacts,
    }, "AI_OPERATIONAL_FALLBACK");
    const reservationInput = {
      organizationId: conversation.organizationId,
      conversationKeyHash: identity.conversationKeyHash,
      clientTurnKeyHash: identity.clientTurnKeyHash,
      requestFingerprint,
      reservedCostMicrousd: estimateOpenAiCostMicrousd(this.aiConfig.maxInputTokens, this.aiConfig.maxOutputTokens),
      dailyLimitMicrousd: usdToMicrousd(this.aiConfig.dailyBudgetUsd),
      monthlyLimitMicrousd: usdToMicrousd(this.aiConfig.monthlyBudgetUsd),
      maxCallsPerConversation: this.aiConfig.maxCallsPerConversation,
      circuitFailureThreshold: this.aiConfig.circuitFailureThreshold,
      circuitOpenSeconds: this.aiConfig.circuitOpenSeconds,
      reservedUntil: new Date(this.now().getTime() + this.aiConfig.reservationTtlMs),
      fallbackResponse: this.toPublicResponse(deterministicFallback),
      now: this.now(),
    } as const;

    let reservation = await this.aiStore.reserve(reservationInput);
    if (reservation.kind === "IN_PROGRESS") reservation = await this.waitForReplay(reservationInput);
    if (reservation.kind === "REPLAY") {
      return this.hydrateStoredResponse(reservation.response, canonicalFacts, canonicalContext.offerPresentation);
    }
    if (reservation.kind === "IN_PROGRESS") {
      throw new ApplicationError("AI_TURN_IN_PROGRESS", "Este turno ainda está sendo processado.", 409);
    }
    if (reservation.kind !== "RESERVED") {
      const executed = await this.executeAndAudit(conversation, contextualInput, canonicalFacts, undefined, true, false, canonicalContext.offerPresentation);
      return this.aiStore.finalizeWithoutCall({
        reservation: reservationInput,
        response: executed.response,
        reason: reservation.kind,
        now: this.now(),
      });
    }

    const executed = await this.executeAndAudit(conversation, contextualInput, canonicalFacts, identity.safetyIdentifier, false, true, canonicalContext.offerPresentation);
    const { response, turn } = executed;
    await this.completeWithRetry({
      executionId: reservation.executionId,
      organizationId: conversation.organizationId,
      response: this.toStoredResponse(turn),
      model: turn.model,
      inputTokens: turn.usage?.inputTokens ?? 0,
      outputTokens: turn.usage?.outputTokens ?? 0,
      actualCostMicrousd: turn.usage
        ? estimateOpenAiCostMicrousd(turn.usage.inputTokens, turn.usage.outputTokens)
        : turn.failureCategory === "UNKNOWN_OUTCOME"
          ? reservationInput.reservedCostMicrousd
          : BigInt(0),
      failureCategory: turn.failureCategory,
      circuitFailureThreshold: this.aiConfig.circuitFailureThreshold,
      circuitOpenSeconds: this.aiConfig.circuitOpenSeconds,
      now: this.now(),
    });
    await this.recordSafeAudit(conversation, input.clientTurnId, turn);
    return response;
  }

  private async completeWithRetry(input: Parameters<AiOperationalStore["complete"]>[0]): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        await this.aiStore!.complete(input);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private async executeAndAudit(
    conversation: PersistedConversation,
    input: { message: string; clientTurnId: string; uiContext: ConversationUiContext; lastSubject?: string },
    canonicalFacts: readonly CanonicalFact[],
    safetyIdentifier: string | undefined,
    deterministic: boolean,
    deferAudit = false,
    offerPresentation?: OfferPresentation,
  ): Promise<Readonly<{ response: AiPublicResponse; turn: Awaited<ReturnType<ConversationTurnOrchestrator["handle"]>> }>> {
    const normalized = {
      channel: "WEBCHAT",
      message: input.message,
      conversationState: conversation.state,
      identityStatus: conversation.identityStatus,
      uiContext: input.uiContext,
      canonicalFacts,
      lastSubject: input.lastSubject,
      pendingOperation: input.lastSubject && ["ACCEPT_OFFER", "MAKE_PAYMENT_PROMISE", "REPORT_PAYMENT", "DISPUTE_DEBT", "CLOSE", "OPT_OUT"].includes(input.lastSubject) ? input.lastSubject as ConversationalIntent : "NONE",
      allowedActions: this.allowedActions(conversation, input.uiContext),
      hasCurrentAcceptance: conversation.state === "OFFER_ACCEPTED",
      safetyIdentifier,
    } as const;
    const interpretedTurn = deterministic
      ? this.orchestrator.handleDeterministic(normalized, "AI_OPERATIONAL_FALLBACK")
      : await this.orchestrator.handle(normalized);
    const turn = offerPresentation &&
      this.requestsOfferExplanation(input.message) &&
      ["HELP", "LIST_OFFERS", "SELECT_OFFER"].includes(interpretedTurn.intent)
      ? {
          ...interpretedTurn,
          message: offerPresentation.publicText,
          storageMessage: offerPresentation.replayMarker,
          suggestedActions: [] as const,
          requiresConfirmation: false,
        }
      : interpretedTurn;
    if (!deferAudit) await this.recordSafeAudit(conversation, input.clientTurnId, turn);
    const response = this.toPublicResponse(turn);
    return { response, turn };
  }

  private toPublicResponse(turn: Awaited<ReturnType<ConversationTurnOrchestrator["handle"]>>): AiPublicResponse {
    return {
      intent: turn.intent,
      message: turn.message,
      suggestedActions: turn.suggestedActions,
      requiresConfirmation: turn.requiresConfirmation,
      fallbackUsed: turn.fallbackUsed,
      ...(turn.quickReplies ? { quickReplies: turn.quickReplies } : {}),
    };
  }

  private toStoredResponse(
    turn: Awaited<ReturnType<ConversationTurnOrchestrator["handle"]>>,
  ): AiPublicResponse {
    const response = this.toPublicResponse(turn);
    return turn.storageMessage
      ? { ...response, message: turn.storageMessage }
      : response;
  }

  private hydrateStoredResponse(
    response: AiPublicResponse,
    canonicalFacts: readonly CanonicalFact[],
    offerPresentation?: OfferPresentation,
  ): AiPublicResponse {
    if (response.message.startsWith("[[OFFER_PRESENTATION:")) {
      if (offerPresentation && response.message === offerPresentation.replayMarker) {
        return { ...response, message: offerPresentation.publicText };
      }
      return {
        intent: "LIST_OFFERS",
        message: "Selecione uma proposta para que eu possa explicar as condições.",
        suggestedActions: ["LIST_OFFERS"],
        requiresConfirmation: false,
        fallbackUsed: true,
      };
    }
    if (!response.message.includes("[[FACT:")) return response;
    const facts = new Map(canonicalFacts.map((fact) => [fact.key, fact.displayText]));
    let missing = false;
    const message = response.message.replace(/\[\[FACT:([A-Za-z0-9_-]{1,80})\]\]/g, (_match, key: string) => {
      const fact = facts.get(key);
      if (!fact) {
        missing = true;
        return "";
      }
      return fact;
    }).replace(/\s+/g, " ").trim();
    if (missing || !message) {
      return {
        intent: "LIST_OFFERS",
        message: "Selecione uma proposta para que eu possa explicar as condições.",
        suggestedActions: ["LIST_OFFERS"],
        requiresConfirmation: false,
        fallbackUsed: true,
      };
    }
    return { ...response, message };
  }

  private async recordSafeAudit(
    conversation: PersistedConversation,
    clientTurnId: string,
    turn: Awaited<ReturnType<ConversationTurnOrchestrator["handle"]>>,
  ): Promise<void> {
    await this.store.recordAudit({
      conversation,
      audit: {
        eventType: "CONVERSATIONAL_INTENT_INTERPRETED",
        actor: "DEBTOR",
        metadata: {
          intent: turn.intent,
          fallbackUsed: turn.fallbackUsed,
          fallbackReason: turn.fallbackReason ?? null,
          model: turn.model ?? null,
          promptVersion: turn.promptVersion ?? null,
          inputTokens: turn.usage?.inputTokens ?? 0,
          outputTokens: turn.usage?.outputTokens ?? 0,
          clientTurnTracked: Boolean(clientTurnId),
          subject: turn.subject ?? null,
        },
        occurredAt: this.now(),
      },
    });
  }

  private async waitForReplay(input: Parameters<AiOperationalStore["reserve"]>[0]): Promise<AiReservationResult> {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      const result = await this.aiStore!.reserve(input);
      if (result.kind !== "IN_PROGRESS") return result;
    }
    throw new ApplicationError("AI_TURN_IN_PROGRESS", "Este turno ainda está sendo processado.", 409);
  }

  private async loadCanonicalContext(
    conversation: PersistedConversation,
    input: { requestId?: string; selectedDebtRef?: string; selectedOfferRef?: string },
  ): Promise<CanonicalTurnContext> {
    if (!input.selectedDebtRef) return { facts: [] };
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
    if (!this.debtProvider) {
      throw new ApplicationError(
        "CONTEXT_UNAVAILABLE",
        "Não foi possível carregar a seleção atual.",
        503,
      );
    }
    const debtor = verifiedDebtorContextSchema.parse(conversation.verifiedDebtorContext);
    const organization = {
      organizationId: conversation.organizationId,
      requestId: input.requestId ?? "webchat-context",
    };
    const debt = await this.debtProvider.getDebt(
      organization,
      debtor,
      input.selectedDebtRef,
    );
    const facts = [...buildDebtCanonicalFacts(debt)];
    if (!input.selectedOfferRef) return { facts };
    const offer = await this.debtProvider.getAuthorizedOffer(
      organization,
      debtor,
      input.selectedOfferRef,
    );
    if (
      offer.debtRef !== debt.debtRef ||
      offer.debtorRef !== debt.debtorRef ||
      offer.creditorRef !== debt.creditor.creditorRef
    ) {
      throw new ApplicationError(
        "CONTEXT_REFERENCE_INVALID",
        "Não foi possível usar a seleção atual. Escolha novamente.",
        400,
      );
    }
    return {
      facts: [...facts, ...buildOfferCanonicalFacts(offer)],
      offerPresentation: this.offerPresentationPolicy?.present(offer) ?? undefined,
    };
  }

  private requestsOfferExplanation(message: string): boolean {
    const normalized = normalizeConversationalText(message);
    return /\b(propost\w*|acord\w*|parcel\w*|condic\w*|term\w*)\b/.test(normalized);
  }

  private allowedActions(conversation: PersistedConversation, uiContext: ConversationUiContext): readonly ConversationalIntent[] {
    if (conversation.state === "CLOSED" || conversation.state === "OPTED_OUT") return [];
    if (conversation.identityStatus === "NOT_STARTED") return ["IDENTIFY_SELF", "CLOSE", "OPT_OUT"];
    if (conversation.identityStatus === "PENDING") return ["VERIFY_IDENTITY", "CLOSE", "OPT_OUT"];
    if (conversation.identityStatus !== "VERIFIED") return ["CLOSE", "OPT_OUT"];
    const actions: ConversationalIntent[] = ["LIST_DEBTS", "SELECT_DEBT", "CLOSE", "OPT_OUT"];
    if (uiContext !== "DEBT_LIST") actions.push("LIST_OFFERS", "SELECT_OFFER", "MAKE_PAYMENT_PROMISE", "REPORT_PAYMENT", "DISPUTE_DEBT");
    if (uiContext === "OFFER_REVIEW") actions.push("ACCEPT_OFFER");
    if (conversation.state === "OFFER_ACCEPTED") actions.push("REQUEST_INSTRUMENT");
    return actions;
  }

  private async authenticate(publicReference: string, token: string | undefined): Promise<PersistedConversation> {
    if (!token) throw new ApplicationError("SESSION_REQUIRED", "Sessão válida obrigatória.", 401);
    const conversation = await this.store.authenticateConversation(
      publicReference,
      hashSessionToken(token, this.sessionSecret),
      new Date(this.now().getTime() - this.sessionMaxAgeSeconds * 1_000),
    );
    if (!conversation) throw new ApplicationError("SESSION_INVALID", "Sessão inválida.", 401);
    return conversation;
  }
}
