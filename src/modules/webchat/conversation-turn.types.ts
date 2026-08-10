export const conversationalIntents = [
  "HELP",
  "IDENTIFY_SELF",
  "VERIFY_IDENTITY",
  "LIST_DEBTS",
  "SELECT_DEBT",
  "LIST_OFFERS",
  "SELECT_OFFER",
  "ACCEPT_OFFER",
  "REQUEST_INSTRUMENT",
  "MAKE_PAYMENT_PROMISE",
  "REPORT_PAYMENT",
  "DISPUTE_DEBT",
  "CLOSE",
  "OPT_OUT",
  "UNKNOWN",
] as const;

export type ConversationalIntent = (typeof conversationalIntents)[number];
export type ConversationUiContext =
  | "IDENTITY"
  | "DEBT_LIST"
  | "DEBT_DETAIL"
  | "OFFER_REVIEW"
  | "ACCEPTED";

export type CanonicalFact = Readonly<{
  key: string;
  displayText: string;
}>;

export type NormalizedInboundTurn = Readonly<{
  channel: "WEBCHAT";
  message: string;
  conversationState: string;
  identityStatus: string;
  uiContext: ConversationUiContext;
  canonicalFacts: readonly CanonicalFact[];
  safetyIdentifier?: string;
}>;

export type BotTurn = Readonly<{
  intent: ConversationalIntent;
  message: string;
  suggestedActions: readonly ConversationalIntent[];
  requiresConfirmation: boolean;
  fallbackUsed: boolean;
  fallbackReason?: string;
  model?: string;
  promptVersion?: string;
  usage?: Readonly<{ inputTokens: number; outputTokens: number }>;
  failureCategory?: import("./ai-operational-store").AiFailureCategory;
  storageMessage?: string;
}>;

export interface ConversationChannelAdapter<TInput> {
  normalize(input: TInput): NormalizedInboundTurn;
}
