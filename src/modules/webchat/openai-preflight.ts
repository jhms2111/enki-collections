import type { RuntimeEnv } from "@/shared/config/env";

import { buildOpenAIIntentRequest, responsesApiPath } from "./openai-responses-intent-client";

export class OpenAIPreflightError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "OpenAIPreflightError";
  }
}

export function validateOpenAIPreflightConfig(env: RuntimeEnv): void {
  if (env.NODE_ENV === "production" || process.env.VERCEL) {
    throw new OpenAIPreflightError("NODE_ENV", "O preflight real é permitido somente no ambiente local.");
  }
  if (!env.OPENAI_ENABLED) throw new OpenAIPreflightError("OPENAI_ENABLED", "OPENAI_ENABLED deve estar true somente no ambiente local.");
  if (!env.OPENAI_API_KEY) throw new OpenAIPreflightError("OPENAI_API_KEY", "A chave local deve estar presente.");
  if (!env.OPENAI_SAFETY_HMAC_SECRET) throw new OpenAIPreflightError("OPENAI_SAFETY_HMAC_SECRET", "O segredo dedicado de safety_identifier deve estar presente.");
  if (env.OPENAI_TIMEOUT_MS !== 10_000) throw new OpenAIPreflightError("OPENAI_TIMEOUT_MS", "O timeout controlado deve ser 10000 ms.");
  if (env.OPENAI_TOTAL_DEADLINE_MS !== 15_000) throw new OpenAIPreflightError("OPENAI_TOTAL_DEADLINE_MS", "O prazo total controlado deve ser 15000 ms.");
  if (env.OPENAI_MAX_RETRIES !== 0) throw new OpenAIPreflightError("OPENAI_MAX_RETRIES", "Retries devem permanecer desabilitados.");
  if (env.OPENAI_TIMEOUT_MS >= env.OPENAI_TOTAL_DEADLINE_MS) throw new OpenAIPreflightError("OPENAI_TOTAL_DEADLINE_MS", "O prazo total deve superar o timeout.");
  if (env.OPENAI_MAX_CALLS_PER_CONVERSATION < 1) throw new OpenAIPreflightError("OPENAI_MAX_CALLS_PER_CONVERSATION", "O limite por conversa deve ser positivo.");
  if (env.OPENAI_DAILY_BUDGET_USD <= 0) throw new OpenAIPreflightError("OPENAI_DAILY_BUDGET_USD", "O limite diário deve ser positivo.");
  if (env.OPENAI_MONTHLY_BUDGET_USD < env.OPENAI_DAILY_BUDGET_USD) throw new OpenAIPreflightError("OPENAI_MONTHLY_BUDGET_USD", "O limite mensal não pode ser inferior ao diário.");
}

export function buildPreflightRequest(env: RuntimeEnv) {
  validateOpenAIPreflightConfig(env);
  return buildOpenAIIntentRequest({
    channel: "WEBCHAT",
    message: "Mensagem inteiramente fictícia para validação local.",
    conversationState: "STARTED",
    identityStatus: "NOT_STARTED",
    uiContext: "IDENTITY",
    canonicalFacts: [],
    safetyIdentifier: "preflight-pseudonym-not-sent",
  }, env.OPENAI_MODEL, env.OPENAI_MAX_OUTPUT_TOKENS);
}

export function assertPreflightRequest(request: ReturnType<typeof buildPreflightRequest>): void {
  if (responsesApiPath !== "/v1/responses") throw new OpenAIPreflightError("OPENAI_ENDPOINT", "Endpoint inesperado.");
  if (request.store !== false || request.reasoning.effort !== "none") throw new OpenAIPreflightError("OPENAI_PAYLOAD", "Controles de persistência ou reasoning inválidos.");
  if ("tools" in request || "previous_response_id" in request) throw new OpenAIPreflightError("OPENAI_PAYLOAD", "O payload não pode conter tools ou previous_response_id.");
  const format = request.text.format;
  if (format.type !== "json_schema" || format.strict !== true || format.name !== "enki_intent") {
    throw new OpenAIPreflightError("OPENAI_SCHEMA", "Structured Outputs estrito não foi construído corretamente.");
  }
  if (format.schema.additionalProperties !== false) throw new OpenAIPreflightError("OPENAI_SCHEMA", "O JSON Schema raiz deve rejeitar campos extras.");
}
