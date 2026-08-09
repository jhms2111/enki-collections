import type { ConversationStore } from "@/modules/conversations/conversation-store";
import type { PersistedConversation } from "@/modules/conversations/persistence.types";
import { hashSessionToken } from "@/shared/auth/session-token";
import { ApplicationError } from "@/shared/errors/application-error";

import { deriveAiOperationalIdentity, estimateOpenAiCostMicrousd, fingerprintAiTurn, usdToMicrousd } from "./ai-operational-identity";
import type { AiOperationalStore, AiPublicResponse, AiReservationResult } from "./ai-operational-store";
import type { ConversationUiContext } from "./conversation-turn.types";
import { ConversationTurnOrchestrator } from "./conversation-turn-orchestrator";

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
  ) {}

  async interpret(input: {
    publicReference: string;
    token?: string;
    message: string;
    clientTurnId: string;
    uiContext: ConversationUiContext;
  }): Promise<AiPublicResponse> {
    const conversation = await this.authenticate(input.publicReference, input.token);
    const preModelTurn = this.orchestrator.handlePreModelGuard({
      channel: "WEBCHAT",
      message: input.message,
      conversationState: conversation.state,
      identityStatus: conversation.identityStatus,
      uiContext: input.uiContext,
      canonicalFacts: [],
    });
    if (preModelTurn) {
      await this.recordSafeAudit(conversation, input.clientTurnId, preModelTurn);
      return this.toPublicResponse(preModelTurn);
    }
    if (!this.aiConfig.enabled) {
      return (await this.executeAndAudit(conversation, input, undefined, false)).response;
    }
    if (!this.aiStore || !this.aiConfig.safetyHmacSecret) {
      return (await this.executeAndAudit(conversation, input, undefined, true)).response;
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
    });
    const deterministicFallback = this.orchestrator.handleDeterministic({
      channel: "WEBCHAT",
      message: input.message,
      conversationState: conversation.state,
      identityStatus: conversation.identityStatus,
      uiContext: input.uiContext,
      canonicalFacts: [],
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
    if (reservation.kind === "REPLAY") return reservation.response;
    if (reservation.kind === "IN_PROGRESS") {
      throw new ApplicationError("AI_TURN_IN_PROGRESS", "Este turno ainda está sendo processado.", 409);
    }
    if (reservation.kind !== "RESERVED") {
      const executed = await this.executeAndAudit(conversation, input, undefined, true, false);
      return this.aiStore.finalizeWithoutCall({
        reservation: reservationInput,
        response: executed.response,
        reason: reservation.kind,
        now: this.now(),
      });
    }

    const executed = await this.executeAndAudit(conversation, input, identity.safetyIdentifier, false, true);
    const { response, turn } = executed;
    await this.completeWithRetry({
      executionId: reservation.executionId,
      organizationId: conversation.organizationId,
      response,
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
    input: { message: string; clientTurnId: string; uiContext: ConversationUiContext },
    safetyIdentifier: string | undefined,
    deterministic: boolean,
    deferAudit = false,
  ): Promise<Readonly<{ response: AiPublicResponse; turn: Awaited<ReturnType<ConversationTurnOrchestrator["handle"]>> }>> {
    const normalized = {
      channel: "WEBCHAT",
      message: input.message,
      conversationState: conversation.state,
      identityStatus: conversation.identityStatus,
      uiContext: input.uiContext,
      canonicalFacts: [],
      safetyIdentifier,
    } as const;
    const turn = deterministic
      ? this.orchestrator.handleDeterministic(normalized, "AI_OPERATIONAL_FALLBACK")
      : await this.orchestrator.handle(normalized);
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
    };
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
