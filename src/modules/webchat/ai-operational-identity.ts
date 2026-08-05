import { createHmac } from "node:crypto";

function hmac(secret: string, domain: string, value: string): string {
  return createHmac("sha256", secret)
    .update(`${domain}:v1:${value}`, "utf8")
    .digest("hex");
}

export function deriveAiOperationalIdentity(input: Readonly<{
  secret: string;
  organizationId: string;
  conversationId: string;
  clientTurnId: string;
}>): Readonly<{
  conversationKeyHash: string;
  clientTurnKeyHash: string;
  safetyIdentifier: string;
}> {
  const scope = `${input.organizationId}:${input.conversationId}`;
  return {
    conversationKeyHash: hmac(input.secret, "openai-conversation", scope),
    clientTurnKeyHash: hmac(input.secret, "openai-client-turn", `${scope}:${input.clientTurnId}`),
    safetyIdentifier: hmac(input.secret, "openai-safety", scope),
  };
}

export function fingerprintAiTurn(
  secret: string,
  payload: Readonly<Record<string, unknown>>,
): string {
  return hmac(secret, "openai-turn-payload", JSON.stringify(payload));
}

export function estimateOpenAiCostMicrousd(inputTokens: number, outputTokens: number): bigint {
  // GPT-5.6 Luna: USD 1/MTok input and USD 6/MTok output.
  return BigInt(inputTokens) + BigInt(outputTokens) * BigInt(6);
}

export function usdToMicrousd(value: number): bigint {
  return BigInt(Math.round(value * 1_000_000));
}
