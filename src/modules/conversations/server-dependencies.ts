import { MockDebtProvider } from "@/modules/debt-provider/mock/mock-debt-provider";
import { getRuntimeEnv } from "@/shared/config/env";
import { getPrisma } from "@/shared/database/prisma";

import { ConversationService } from "./conversation-service";
import { OfferAcceptanceService } from "./offer-acceptance-service";
import { OccurrenceService } from "./occurrence-service";
import { PrismaAcceptanceStore } from "./prisma-acceptance-store";
import { PrismaConversationStore } from "./prisma-conversation-store";
import { PrismaOccurrenceStore } from "./prisma-occurrence-store";

const mockDebtProvider = new MockDebtProvider();

export function getConversationService(): ConversationService {
  const env = getRuntimeEnv();
  return new ConversationService(
    new PrismaConversationStore(getPrisma()),
    mockDebtProvider,
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
    mockDebtProvider,
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
    mockDebtProvider,
    env.CONVERSATION_SESSION_SECRET,
    env.IDEMPOTENCY_HMAC_SECRET,
    env.SESSION_COOKIE_MAX_AGE_SECONDS,
  );
}
