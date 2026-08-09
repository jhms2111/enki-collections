import type { BotTurn } from "./conversation-turn.types";

export type AiPublicResponse = Pick<
  BotTurn,
  "intent" | "message" | "suggestedActions" | "requiresConfirmation" | "fallbackUsed"
>;

export type AiFailureCategory =
  | "INVALID_REQUEST"
  | "MODEL_UNAVAILABLE"
  | "AUTHENTICATION"
  | "QUOTA"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "SERVER_ERROR"
  | "NETWORK"
  | "UNKNOWN_OUTCOME"
  | "INVALID_STRUCTURED_OUTPUT"
  | "RESPONSE_PARSE_ERROR"
  | "POLICY";

export type AiReservationInput = Readonly<{
  organizationId: string;
  conversationKeyHash: string;
  clientTurnKeyHash: string;
  requestFingerprint: string;
  reservedCostMicrousd: bigint;
  dailyLimitMicrousd: bigint;
  monthlyLimitMicrousd: bigint;
  maxCallsPerConversation: number;
  circuitFailureThreshold: number;
  circuitOpenSeconds: number;
  reservedUntil: Date;
  fallbackResponse: AiPublicResponse;
  now: Date;
}>;

export type AiReservationResult =
  | Readonly<{ kind: "RESERVED"; executionId: string }>
  | Readonly<{ kind: "REPLAY"; response: AiPublicResponse }>
  | Readonly<{ kind: "IN_PROGRESS" }>
  | Readonly<{ kind: "BUDGET_EXHAUSTED" | "CONVERSATION_LIMIT" | "CIRCUIT_OPEN" }>;

export interface AiOperationalStore {
  reserve(input: AiReservationInput): Promise<AiReservationResult>;
  finalizeWithoutCall(input: Readonly<{
    reservation: AiReservationInput;
    response: AiPublicResponse;
    reason: "BUDGET_EXHAUSTED" | "CONVERSATION_LIMIT" | "CIRCUIT_OPEN";
    now: Date;
  }>): Promise<AiPublicResponse>;
  complete(input: Readonly<{
    executionId: string;
    organizationId: string;
    response: AiPublicResponse;
    model?: string;
    inputTokens: number;
    outputTokens: number;
    actualCostMicrousd: bigint;
    failureCategory?: AiFailureCategory;
    circuitFailureThreshold: number;
    circuitOpenSeconds: number;
    now: Date;
  }>): Promise<void>;
}
