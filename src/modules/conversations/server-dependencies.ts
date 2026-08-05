import { SandboxDebtProvider } from "@/modules/debt-provider/sandbox/sandbox-debt-provider";
import { getRuntimeEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/database/prisma";

import { ConversationService } from "./conversation-service";
import { OfferAcceptanceService } from "./offer-acceptance-service";
import { OccurrenceService } from "./occurrence-service";
import { PrismaAcceptanceStore } from "./prisma-acceptance-store";
import { PrismaConversationStore } from "./prisma-conversation-store";
import { PrismaOccurrenceStore } from "./prisma-occurrence-store";
import { ClosedAiUsageBudgetGate, ConversationTurnOrchestrator } from "@/modules/webchat/conversation-turn-orchestrator";
import { ConversationTurnService } from "@/modules/webchat/conversation-turn-service";
import { UnavailableNaturalLanguageIntentClient } from "@/modules/webchat/openai-responses-intent-client";

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
  return new ConversationTurnService(
    new PrismaConversationStore(getPrisma()),
    new ConversationTurnOrchestrator(
      new UnavailableNaturalLanguageIntentClient(),
      new ClosedAiUsageBudgetGate(),
      { enabled: env.OPENAI_ENABLED, model: env.OPENAI_MODEL },
    ),
    env.CONVERSATION_SESSION_SECRET,
    env.SESSION_COOKIE_MAX_AGE_SECONDS,
  );
}
