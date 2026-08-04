CREATE TYPE "SandboxRecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "InternalRole" AS ENUM ('SANDBOX_EDITOR');

CREATE TABLE "InternalSession" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "tokenHash" CHAR(64) NOT NULL,
  "role" "InternalRole" NOT NULL DEFAULT 'SANDBOX_EDITOR', "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3), "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "InternalSession_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "InternalAuditEvent" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "internalSessionId" TEXT,
  "eventType" VARCHAR(100) NOT NULL, "entityType" VARCHAR(80), "entityRef" VARCHAR(160),
  "metadata" JSONB NOT NULL, "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InternalAuditEvent_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "SandboxCreditor" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "creditorRef" VARCHAR(160) NOT NULL,
  "displayName" VARCHAR(100) NOT NULL, "status" "SandboxRecordStatus" NOT NULL DEFAULT 'ACTIVE',
  "isDemo" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SandboxCreditor_pkey" PRIMARY KEY ("id"), CONSTRAINT "SandboxCreditor_is_demo" CHECK ("isDemo" = true)
);
CREATE TABLE "SandboxIdentityProfile" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "profileRef" VARCHAR(160) NOT NULL,
  "demoIdentifier" VARCHAR(48) NOT NULL, "maskedDisplayName" VARCHAR(80) NOT NULL,
  "status" "SandboxRecordStatus" NOT NULL DEFAULT 'ACTIVE', "isDemo" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SandboxIdentityProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SandboxIdentityProfile_is_demo" CHECK ("isDemo" = true)
);
CREATE TABLE "SandboxIdentityChallenge" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "identityProfileId" TEXT NOT NULL,
  "challengeRef" VARCHAR(160) NOT NULL, "prompt" VARCHAR(200) NOT NULL, "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "status" "SandboxRecordStatus" NOT NULL DEFAULT 'ACTIVE', "isDemo" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SandboxIdentityChallenge_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SandboxIdentityChallenge_is_demo" CHECK ("isDemo" = true),
  CONSTRAINT "SandboxIdentityChallenge_attempts" CHECK ("maxAttempts" = 3)
);
CREATE TABLE "SandboxIdentityChallengeOption" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "challengeId" TEXT NOT NULL,
  "optionRef" VARCHAR(160) NOT NULL, "label" VARCHAR(60) NOT NULL, "isCorrect" BOOLEAN NOT NULL,
  "position" INTEGER NOT NULL, "isDemo" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "SandboxIdentityChallengeOption_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SandboxIdentityChallengeOption_is_demo" CHECK ("isDemo" = true)
);
CREATE TABLE "SandboxDebtor" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "creditorId" TEXT NOT NULL,
  "identityProfileId" TEXT NOT NULL, "debtorRef" VARCHAR(160) NOT NULL,
  "status" "SandboxRecordStatus" NOT NULL DEFAULT 'ACTIVE', "isDemo" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SandboxDebtor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SandboxDebtor_is_demo" CHECK ("isDemo" = true)
);
CREATE TABLE "SandboxDebt" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "creditorId" TEXT NOT NULL, "debtorId" TEXT NOT NULL,
  "debtRef" VARCHAR(160) NOT NULL, "description" VARCHAR(160) NOT NULL, "amountInCents" INTEGER NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'BRL', "dueDate" DATE NOT NULL, "status" VARCHAR(24) NOT NULL DEFAULT 'OPEN',
  "recordStatus" "SandboxRecordStatus" NOT NULL DEFAULT 'ACTIVE', "isDemo" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SandboxDebt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SandboxDebt_is_demo" CHECK ("isDemo" = true), CONSTRAINT "SandboxDebt_amount" CHECK ("amountInCents" BETWEEN 1 AND 100000000),
  CONSTRAINT "SandboxDebt_currency" CHECK ("currency" = 'BRL'), CONSTRAINT "SandboxDebt_status" CHECK ("status" IN ('OPEN','DISPUTED','PAID'))
);
CREATE TABLE "SandboxAuthorizedOffer" (
  "id" TEXT NOT NULL, "organizationId" TEXT NOT NULL, "debtId" TEXT NOT NULL, "offerRef" VARCHAR(160) NOT NULL,
  "kind" VARCHAR(24) NOT NULL, "totalAmountInCents" INTEGER NOT NULL, "downPaymentAmountInCents" INTEGER NOT NULL,
  "installmentCount" INTEGER NOT NULL, "installmentAmountInCents" INTEGER NOT NULL, "firstDueDate" DATE NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "status" VARCHAR(24) NOT NULL DEFAULT 'AVAILABLE',
  "recordStatus" "SandboxRecordStatus" NOT NULL DEFAULT 'ACTIVE', "isDemo" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "SandboxAuthorizedOffer_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SandboxAuthorizedOffer_is_demo" CHECK ("isDemo" = true),
  CONSTRAINT "SandboxAuthorizedOffer_kind" CHECK ("kind" IN ('CASH','INSTALLMENT')),
  CONSTRAINT "SandboxAuthorizedOffer_status" CHECK ("status" IN ('AVAILABLE','EXPIRED','DISABLED')),
  CONSTRAINT "SandboxAuthorizedOffer_amounts" CHECK ("totalAmountInCents" BETWEEN 1 AND 100000000 AND "downPaymentAmountInCents" BETWEEN 0 AND 100000000 AND "installmentAmountInCents" BETWEEN 1 AND 100000000 AND "installmentCount" BETWEEN 1 AND 120)
);

CREATE UNIQUE INDEX "InternalSession_tokenHash_key" ON "InternalSession"("tokenHash");
CREATE INDEX "InternalSession_organizationId_expiresAt_idx" ON "InternalSession"("organizationId", "expiresAt");
CREATE INDEX "InternalAuditEvent_organizationId_occurredAt_idx" ON "InternalAuditEvent"("organizationId", "occurredAt");
CREATE UNIQUE INDEX "SandboxCreditor_organizationId_creditorRef_key" ON "SandboxCreditor"("organizationId", "creditorRef");
CREATE UNIQUE INDEX "SandboxCreditor_id_organizationId_key" ON "SandboxCreditor"("id", "organizationId");
CREATE INDEX "SandboxCreditor_organizationId_status_idx" ON "SandboxCreditor"("organizationId", "status");
CREATE UNIQUE INDEX "SandboxIdentityProfile_organizationId_profileRef_key" ON "SandboxIdentityProfile"("organizationId", "profileRef");
CREATE UNIQUE INDEX "SandboxIdentityProfile_organizationId_demoIdentifier_key" ON "SandboxIdentityProfile"("organizationId", "demoIdentifier");
CREATE UNIQUE INDEX "SandboxIdentityProfile_id_organizationId_key" ON "SandboxIdentityProfile"("id", "organizationId");
CREATE INDEX "SandboxIdentityProfile_organizationId_status_idx" ON "SandboxIdentityProfile"("organizationId", "status");
CREATE UNIQUE INDEX "SandboxIdentityChallenge_identityProfileId_key" ON "SandboxIdentityChallenge"("identityProfileId");
CREATE UNIQUE INDEX "SandboxIdentityChallenge_organizationId_challengeRef_key" ON "SandboxIdentityChallenge"("organizationId", "challengeRef");
CREATE UNIQUE INDEX "SandboxIdentityChallenge_identityProfileId_organizationId_key" ON "SandboxIdentityChallenge"("identityProfileId", "organizationId");
CREATE UNIQUE INDEX "SandboxIdentityChallenge_id_organizationId_key" ON "SandboxIdentityChallenge"("id", "organizationId");
CREATE INDEX "SandboxIdentityChallenge_organizationId_status_idx" ON "SandboxIdentityChallenge"("organizationId", "status");
CREATE UNIQUE INDEX "SandboxIdentityChallengeOption_organizationId_challengeId_optionRef_key" ON "SandboxIdentityChallengeOption"("organizationId", "challengeId", "optionRef");
CREATE UNIQUE INDEX "SandboxIdentityChallengeOption_challengeId_position_key" ON "SandboxIdentityChallengeOption"("challengeId", "position");
CREATE INDEX "SandboxIdentityChallengeOption_organizationId_challengeId_idx" ON "SandboxIdentityChallengeOption"("organizationId", "challengeId");
CREATE UNIQUE INDEX "SandboxDebtor_organizationId_debtorRef_key" ON "SandboxDebtor"("organizationId", "debtorRef");
CREATE UNIQUE INDEX "SandboxDebtor_organizationId_creditorId_identityProfileId_key" ON "SandboxDebtor"("organizationId", "creditorId", "identityProfileId");
CREATE UNIQUE INDEX "SandboxDebtor_id_organizationId_key" ON "SandboxDebtor"("id", "organizationId");
CREATE INDEX "SandboxDebtor_organizationId_status_idx" ON "SandboxDebtor"("organizationId", "status");
CREATE UNIQUE INDEX "SandboxDebt_organizationId_debtRef_key" ON "SandboxDebt"("organizationId", "debtRef");
CREATE UNIQUE INDEX "SandboxDebt_id_organizationId_key" ON "SandboxDebt"("id", "organizationId");
CREATE INDEX "SandboxDebt_organizationId_debtorId_recordStatus_idx" ON "SandboxDebt"("organizationId", "debtorId", "recordStatus");
CREATE UNIQUE INDEX "SandboxAuthorizedOffer_organizationId_offerRef_key" ON "SandboxAuthorizedOffer"("organizationId", "offerRef");
CREATE INDEX "SandboxAuthorizedOffer_organizationId_debtId_recordStatus_idx" ON "SandboxAuthorizedOffer"("organizationId", "debtId", "recordStatus");

ALTER TABLE "InternalSession" ADD CONSTRAINT "InternalSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "InternalAuditEvent" ADD CONSTRAINT "InternalAuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalAuditEvent" ADD CONSTRAINT "InternalAuditEvent_internalSessionId_fkey" FOREIGN KEY ("internalSessionId") REFERENCES "InternalSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SandboxCreditor" ADD CONSTRAINT "SandboxCreditor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxIdentityProfile" ADD CONSTRAINT "SandboxIdentityProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxIdentityChallenge" ADD CONSTRAINT "SandboxIdentityChallenge_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxIdentityChallenge" ADD CONSTRAINT "SandboxIdentityChallenge_identityProfileId_organizationId_fkey" FOREIGN KEY ("identityProfileId", "organizationId") REFERENCES "SandboxIdentityProfile"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxIdentityChallengeOption" ADD CONSTRAINT "SandboxIdentityChallengeOption_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxIdentityChallengeOption" ADD CONSTRAINT "SandboxIdentityChallengeOption_challengeId_organizationId_fkey" FOREIGN KEY ("challengeId", "organizationId") REFERENCES "SandboxIdentityChallenge"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxDebtor" ADD CONSTRAINT "SandboxDebtor_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxDebtor" ADD CONSTRAINT "SandboxDebtor_creditorId_organizationId_fkey" FOREIGN KEY ("creditorId", "organizationId") REFERENCES "SandboxCreditor"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxDebtor" ADD CONSTRAINT "SandboxDebtor_identityProfileId_organizationId_fkey" FOREIGN KEY ("identityProfileId", "organizationId") REFERENCES "SandboxIdentityProfile"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxDebt" ADD CONSTRAINT "SandboxDebt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxDebt" ADD CONSTRAINT "SandboxDebt_creditorId_organizationId_fkey" FOREIGN KEY ("creditorId", "organizationId") REFERENCES "SandboxCreditor"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxDebt" ADD CONSTRAINT "SandboxDebt_debtorId_organizationId_fkey" FOREIGN KEY ("debtorId", "organizationId") REFERENCES "SandboxDebtor"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxAuthorizedOffer" ADD CONSTRAINT "SandboxAuthorizedOffer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SandboxAuthorizedOffer" ADD CONSTRAINT "SandboxAuthorizedOffer_debtId_organizationId_fkey" FOREIGN KEY ("debtId", "organizationId") REFERENCES "SandboxDebt"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
