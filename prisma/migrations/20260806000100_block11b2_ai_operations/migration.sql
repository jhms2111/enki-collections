-- Operational AI controls with sanitized fields only.
CREATE TYPE "AiTurnStatus" AS ENUM ('RESERVED', 'SUCCEEDED', 'FALLBACK');
CREATE TYPE "AiBudgetPeriodType" AS ENUM ('DAILY', 'MONTHLY');
CREATE TYPE "AiCircuitState" AS ENUM ('CLOSED', 'OPEN', 'HALF_OPEN');

CREATE TABLE "AiTurnExecution" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "conversationKeyHash" CHAR(64) NOT NULL,
    "clientTurnKeyHash" CHAR(64) NOT NULL,
    "requestFingerprint" CHAR(64) NOT NULL,
    "status" "AiTurnStatus" NOT NULL DEFAULT 'RESERVED',
    "reservedCostMicrousd" BIGINT NOT NULL,
    "actualCostMicrousd" BIGINT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "model" VARCHAR(80),
    "publicResponse" JSONB,
    "failureCategory" VARCHAR(40),
    "reservedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "AiTurnExecution_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiBudgetPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodType" "AiBudgetPeriodType" NOT NULL,
    "periodStart" DATE NOT NULL,
    "allocatedCostMicrousd" BIGINT NOT NULL DEFAULT 0,
    "reservedCostMicrousd" BIGINT NOT NULL DEFAULT 0,
    "consumedCostMicrousd" BIGINT NOT NULL DEFAULT 0,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiBudgetPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiCircuitBreaker" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "state" "AiCircuitState" NOT NULL DEFAULT 'CLOSED',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "windowStartedAt" TIMESTAMP(3),
    "openUntil" TIMESTAMP(3),
    "halfOpenProbeInFlight" BOOLEAN NOT NULL DEFAULT false,
    "lastFailureCategory" VARCHAR(40),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiCircuitBreaker_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiTurnExecution_organizationId_conversationKeyHash_clientTurnKeyHash_key"
ON "AiTurnExecution"("organizationId", "conversationKeyHash", "clientTurnKeyHash");
CREATE INDEX "AiTurnExecution_organizationId_status_createdAt_idx"
ON "AiTurnExecution"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "AiBudgetPeriod_organizationId_periodType_periodStart_key"
ON "AiBudgetPeriod"("organizationId", "periodType", "periodStart");
CREATE INDEX "AiBudgetPeriod_organizationId_periodStart_idx"
ON "AiBudgetPeriod"("organizationId", "periodStart");
CREATE UNIQUE INDEX "AiCircuitBreaker_organizationId_key"
ON "AiCircuitBreaker"("organizationId");

ALTER TABLE "AiTurnExecution" ADD CONSTRAINT "AiTurnExecution_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiBudgetPeriod" ADD CONSTRAINT "AiBudgetPeriod_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiCircuitBreaker" ADD CONSTRAINT "AiCircuitBreaker_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
