CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');
CREATE TYPE "ConversationChannel" AS ENUM ('WEBCHAT');
CREATE TYPE "ConversationState" AS ENUM ('STARTED', 'IDENTIFIED', 'IDENTITY_VERIFIED', 'DEBT_SELECTED', 'OFFER_SELECTED', 'OFFER_ACCEPTED', 'HUMAN_HANDOFF', 'OPTED_OUT', 'IDENTITY_BLOCKED', 'CLOSED');
CREATE TYPE "IdentityStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'BLOCKED');
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');
CREATE TYPE "MessageActor" AS ENUM ('DEBTOR', 'SYSTEM', 'HUMAN_AGENT');
CREATE TYPE "AuditActor" AS ENUM ('DEBTOR', 'SYSTEM', 'HUMAN_AGENT');

CREATE TABLE "Organization" (
  "id" TEXT NOT NULL,
  "slug" VARCHAR(80) NOT NULL,
  "externalRef" VARCHAR(160) NOT NULL,
  "name" VARCHAR(160) NOT NULL,
  "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Conversation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "publicReference" VARCHAR(80) NOT NULL,
  "sessionTokenHash" CHAR(64) NOT NULL,
  "channel" "ConversationChannel" NOT NULL DEFAULT 'WEBCHAT',
  "state" "ConversationState" NOT NULL DEFAULT 'STARTED',
  "debtorRef" VARCHAR(160),
  "identityStatus" "IdentityStatus" NOT NULL DEFAULT 'NOT_STARTED',
  "failedIdentityAttempts" INTEGER NOT NULL DEFAULT 0,
  "identityLockedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "optedOutAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "direction" "MessageDirection" NOT NULL,
  "actor" "MessageActor" NOT NULL,
  "content" VARCHAR(2000) NOT NULL,
  "intent" VARCHAR(80),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditEvent" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "eventType" VARCHAR(100) NOT NULL,
  "actor" "AuditActor" NOT NULL,
  "entityType" VARCHAR(80),
  "entityRef" VARCHAR(160),
  "metadata" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IdempotencyRecord" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "operation" VARCHAR(80) NOT NULL,
  "idempotencyKey" VARCHAR(128) NOT NULL,
  "requestFingerprint" CHAR(64) NOT NULL,
  "responsePayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");
CREATE UNIQUE INDEX "Organization_externalRef_key" ON "Organization"("externalRef");
CREATE UNIQUE INDEX "Conversation_publicReference_key" ON "Conversation"("publicReference");
CREATE UNIQUE INDEX "Conversation_id_organizationId_key" ON "Conversation"("id", "organizationId");
CREATE INDEX "Conversation_organizationId_lastActivityAt_idx" ON "Conversation"("organizationId", "lastActivityAt");
CREATE INDEX "Conversation_organizationId_sessionTokenHash_idx" ON "Conversation"("organizationId", "sessionTokenHash");
CREATE INDEX "Message_organizationId_conversationId_createdAt_idx" ON "Message"("organizationId", "conversationId", "createdAt");
CREATE INDEX "AuditEvent_organizationId_conversationId_occurredAt_idx" ON "AuditEvent"("organizationId", "conversationId", "occurredAt");
CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_operation_idempotencyKey_key" ON "IdempotencyRecord"("organizationId", "operation", "idempotencyKey");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Message"
  ADD CONSTRAINT "Message_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Message"
  ADD CONSTRAINT "Message_conversationId_organizationId_fkey"
  FOREIGN KEY ("conversationId", "organizationId")
  REFERENCES "Conversation"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "AuditEvent"
  ADD CONSTRAINT "AuditEvent_conversationId_organizationId_fkey"
  FOREIGN KEY ("conversationId", "organizationId")
  REFERENCES "Conversation"("id", "organizationId")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IdempotencyRecord"
  ADD CONSTRAINT "IdempotencyRecord_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
