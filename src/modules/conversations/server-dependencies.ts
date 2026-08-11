import { SandboxDebtProvider } from "@/modules/debt-provider/sandbox/sandbox-debt-provider";
import { SandboxOfferPresentationPolicy } from "@/modules/debt-provider/sandbox/sandbox-offer-presentation-policy";
import { getRuntimeEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/database/prisma";

import { ConversationService } from "./conversation-service";
import { OfferAcceptanceService } from "./offer-acceptance-service";
import { OccurrenceService } from "./occurrence-service";
import { PrismaAcceptanceStore } from "./prisma-acceptance-store";
import { PrismaConversationStore } from "./prisma-conversation-store";
import { PrismaOccurrenceStore } from "./prisma-occurrence-store";
import { ClosedAiUsageBudgetGate, ConversationTurnOrchestrator, ReservedAiUsageBudgetGate } from "@/modules/webchat/conversation-turn-orchestrator";
import { ConversationTurnService } from "@/modules/webchat/conversation-turn-service";
import { FetchOpenAIResponsesTransport, LazyNaturalLanguageIntentClient, OpenAIResponsesIntentClient, UnavailableNaturalLanguageIntentClient } from "@/modules/webchat/openai-responses-intent-client";
import { PrismaAiOperationalStore } from "@/modules/webchat/prisma-ai-operational-store";

export function getConversationService(): ConversationService {
  const env = getRuntimeEnv();
  const client = getPrisma();
  return new ConversationService(
    new PrismaConversationStore(client),
    new SandboxDebtProvider(client),
    env.CONVERSATION_SESSION_SECRET,
    env.IDENTITY_MAX_ATTEMPTS,
    env.SESSION_COOKIE_MAX_AGE_SECONDS,
  );
}

export function getOccurrenceService(): OccurrenceService {
  const env = getRuntimeEnv();
  const client = getPrisma();
  return new OccurrenceService(
    new PrismaConversationStore(client),
    new PrismaOccurrenceStore(client),
    new SandboxDebtProvider(client),
    env.CONVERSATION_SESSION_SECRET,
    env.IDEMPOTENCY_HMAC_SECRET,
    env.SESSION_COOKIE_MAX_AGE_SECONDS,
  );
}

export function getOfferAcceptanceService(): OfferAcceptanceService {
  const env = getRuntimeEnv();
  const client = getPrisma();
  return new OfferAcceptanceService(
    new PrismaConversationStore(client),
    new PrismaAcceptanceStore(client),
    new SandboxDebtProvider(client),
    env.CONVERSATION_SESSION_SECRET,
    env.IDEMPOTENCY_HMAC_SECRET,
    env.SESSION_COOKIE_MAX_AGE_SECONDS,
  );
}

export function getConversationTurnService(): ConversationTurnService {
  const env = getRuntimeEnv();
  const prisma = getPrisma();
  const intentClient = env.OPENAI_ENABLED && env.OPENAI_API_KEY
    ? new LazyNaturalLanguageIntentClient(() => new OpenAIResponsesIntentClient(
      new FetchOpenAIResponsesTransport(
        env.OPENAI_API_KEY!,
        env.OPENAI_MAX_RETRIES,
        env.OPENAI_TOTAL_DEADLINE_MS,
      ),
      env.OPENAI_MODEL,
      env.OPENAI_TIMEOUT_MS,
      env.OPENAI_MAX_OUTPUT_TOKENS,
    ))
    : new UnavailableNaturalLanguageIntentClient();
  const debtProvider = new SandboxDebtProvider(prisma);
  return new ConversationTurnService(
    new PrismaConversationStore(prisma),
    new ConversationTurnOrchestrator(
      intentClient,
      env.OPENAI_ENABLED ? new ReservedAiUsageBudgetGate() : new ClosedAiUsageBudgetGate(),
      { enabled: env.OPENAI_ENABLED, model: env.OPENAI_MODEL },
    ),
    env.CONVERSATION_SESSION_SECRET,
    env.SESSION_COOKIE_MAX_AGE_SECONDS,
    undefined,
    env.OPENAI_ENABLED ? new PrismaAiOperationalStore(prisma) : undefined,
    {
      enabled: env.OPENAI_ENABLED,
      model: env.OPENAI_MODEL,
      safetyHmacSecret: env.OPENAI_SAFETY_HMAC_SECRET,
      maxInputTokens: env.OPENAI_MAX_INPUT_TOKENS,
      maxOutputTokens: env.OPENAI_MAX_OUTPUT_TOKENS,
      maxCallsPerConversation: env.OPENAI_MAX_CALLS_PER_CONVERSATION,
      dailyBudgetUsd: env.OPENAI_DAILY_BUDGET_USD,
      monthlyBudgetUsd: env.OPENAI_MONTHLY_BUDGET_USD,
      circuitFailureThreshold: env.OPENAI_CIRCUIT_FAILURE_THRESHOLD,
      circuitOpenSeconds: env.OPENAI_CIRCUIT_OPEN_SECONDS,
      reservationTtlMs: env.OPENAI_TOTAL_DEADLINE_MS + 5_000,
    },
    debtProvider,
    new SandboxOfferPresentationPolicy(),
  );
}
