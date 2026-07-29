import { ApplicationError } from "@/shared/errors/application-error";

export const conversationStates = [
  "STARTED",
  "IDENTIFIED",
  "IDENTITY_VERIFIED",
  "DEBT_SELECTED",
  "OFFER_SELECTED",
  "OFFER_ACCEPTED",
  "HUMAN_HANDOFF",
  "OPTED_OUT",
  "IDENTITY_BLOCKED",
  "CLOSED",
] as const;

export type ConversationState = (typeof conversationStates)[number];

const allowedTransitions: Readonly<
  Record<ConversationState, readonly ConversationState[]>
> = {
  STARTED: ["IDENTIFIED", "HUMAN_HANDOFF", "OPTED_OUT", "CLOSED"],
  IDENTIFIED: [
    "IDENTITY_VERIFIED",
    "IDENTITY_BLOCKED",
    "HUMAN_HANDOFF",
    "OPTED_OUT",
    "CLOSED",
  ],
  IDENTITY_VERIFIED: [
    "DEBT_SELECTED",
    "HUMAN_HANDOFF",
    "OPTED_OUT",
    "CLOSED",
  ],
  DEBT_SELECTED: [
    "OFFER_SELECTED",
    "IDENTITY_VERIFIED",
    "HUMAN_HANDOFF",
    "OPTED_OUT",
    "CLOSED",
  ],
  OFFER_SELECTED: [
    "OFFER_ACCEPTED",
    "DEBT_SELECTED",
    "HUMAN_HANDOFF",
    "OPTED_OUT",
    "CLOSED",
  ],
  OFFER_ACCEPTED: ["HUMAN_HANDOFF", "OPTED_OUT", "CLOSED"],
  HUMAN_HANDOFF: ["OPTED_OUT", "CLOSED"],
  OPTED_OUT: ["CLOSED"],
  IDENTITY_BLOCKED: ["HUMAN_HANDOFF", "OPTED_OUT", "CLOSED"],
  CLOSED: [],
};

export function assertConversationTransition(
  from: ConversationState,
  to: ConversationState,
): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new ApplicationError(
      "INVALID_CONVERSATION_TRANSITION",
      `Transição inválida de ${from} para ${to}.`,
      409,
    );
  }
}

