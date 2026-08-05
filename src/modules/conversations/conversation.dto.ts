import type { PersistedConversation } from "./persistence.types";

export type PublicConversationDto = Readonly<{
  id: string;
  channel: "WEBCHAT";
  state: PersistedConversation["state"];
  identityStatus: PersistedConversation["identityStatus"];
  failedIdentityAttempts: number;
  startedAt: string;
  lastActivityAt: string;
  endedAt: string | null;
  optedOutAt: string | null;
  messages: readonly Readonly<{
    direction: "INBOUND" | "OUTBOUND";
    actor: "DEBTOR" | "SYSTEM" | "HUMAN_AGENT";
    content: string;
    intent: string | null;
    createdAt: string;
  }>[];
}>;

export function toPublicConversationDto(
  conversation: PersistedConversation,
): PublicConversationDto {
  return {
    id: conversation.publicReference,
    channel: "WEBCHAT",
    state: conversation.state,
    identityStatus: conversation.identityStatus,
    failedIdentityAttempts: conversation.failedIdentityAttempts,
    startedAt: conversation.startedAt.toISOString(),
    lastActivityAt: conversation.lastActivityAt.toISOString(),
    endedAt: conversation.endedAt?.toISOString() ?? null,
    optedOutAt: conversation.optedOutAt?.toISOString() ?? null,
    messages: conversation.messages.map((message) => ({
      direction: message.direction,
      actor: message.actor,
      content: message.content,
      intent: message.intent,
      createdAt: message.createdAt.toISOString(),
    })),
  };
}
