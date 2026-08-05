import type { ConversationStore } from "@/modules/conversations/conversation-store";
import type { PersistedConversation } from "@/modules/conversations/persistence.types";
import { hashSessionToken } from "@/shared/auth/session-token";
import { ApplicationError } from "@/shared/errors/application-error";

import type { ConversationUiContext } from "./conversation-turn.types";
import { ConversationTurnOrchestrator } from "./conversation-turn-orchestrator";

export class ConversationTurnService {
  constructor(
    private readonly store: ConversationStore,
    private readonly orchestrator: ConversationTurnOrchestrator,
    private readonly sessionSecret: string,
    private readonly sessionMaxAgeSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async interpret(input: {
    publicReference: string;
    token?: string;
    message: string;
    clientTurnId: string;
    uiContext: ConversationUiContext;
  }) {
    const conversation = await this.authenticate(input.publicReference, input.token);
    const turn = await this.orchestrator.handle({
      channel: "WEBCHAT",
      message: input.message,
      conversationState: conversation.state,
      identityStatus: conversation.identityStatus,
      uiContext: input.uiContext,
      canonicalFacts: [],
    });
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
          clientTurnTracked: Boolean(input.clientTurnId),
        },
        occurredAt: this.now(),
      },
    });
    return {
      intent: turn.intent,
      message: turn.message,
      suggestedActions: turn.suggestedActions,
      requiresConfirmation: turn.requiresConfirmation,
      fallbackUsed: turn.fallbackUsed,
    };
  }

  private async authenticate(
    publicReference: string,
    token: string | undefined,
  ): Promise<PersistedConversation> {
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
