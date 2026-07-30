ALTER TABLE "Organization"
ADD COLUMN "timeZone" VARCHAR(64) NOT NULL DEFAULT 'UTC';

CREATE TABLE "PaymentPromise" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "publicReference" VARCHAR(80) NOT NULL,
  "debtRef" VARCHAR(160) NOT NULL,
  "offerRef" VARCHAR(160),
  "providerReference" VARCHAR(160) NOT NULL,
  "promisedDate" DATE NOT NULL,
  "timeZone" VARCHAR(64) NOT NULL,
  "status" VARCHAR(40) NOT NULL,
  "idempotencyKeyHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentPromise_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentReport" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "publicReference" VARCHAR(80) NOT NULL,
  "debtRef" VARCHAR(160) NOT NULL,
  "providerReference" VARCHAR(160) NOT NULL,
  "reportedAt" TIMESTAMP(3) NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL,
  "status" VARCHAR(40) NOT NULL,
  "idempotencyKeyHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaymentReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Dispute" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "publicReference" VARCHAR(80) NOT NULL,
  "debtRef" VARCHAR(160) NOT NULL,
  "providerReference" VARCHAR(160) NOT NULL,
  "reasonCode" VARCHAR(40) NOT NULL,
  "description" VARCHAR(300),
  "status" VARCHAR(40) NOT NULL,
  "idempotencyKeyHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentPromise_publicReference_key" ON "PaymentPromise"("publicReference");
CREATE UNIQUE INDEX "PaymentPromise_organizationId_providerReference_key" ON "PaymentPromise"("organizationId", "providerReference");
CREATE UNIQUE INDEX "PaymentPromise_organizationId_conversationId_debtRef_idempotencyKeyHash_key" ON "PaymentPromise"("organizationId", "conversationId", "debtRef", "idempotencyKeyHash");
CREATE INDEX "PaymentPromise_organizationId_conversationId_createdAt_idx" ON "PaymentPromise"("organizationId", "conversationId", "createdAt");

CREATE UNIQUE INDEX "PaymentReport_publicReference_key" ON "PaymentReport"("publicReference");
CREATE UNIQUE INDEX "PaymentReport_organizationId_providerReference_key" ON "PaymentReport"("organizationId", "providerReference");
CREATE UNIQUE INDEX "PaymentReport_organizationId_conversationId_debtRef_idempotencyKeyHash_key" ON "PaymentReport"("organizationId", "conversationId", "debtRef", "idempotencyKeyHash");
CREATE INDEX "PaymentReport_organizationId_conversationId_receivedAt_idx" ON "PaymentReport"("organizationId", "conversationId", "receivedAt");

CREATE UNIQUE INDEX "Dispute_publicReference_key" ON "Dispute"("publicReference");
CREATE UNIQUE INDEX "Dispute_organizationId_providerReference_key" ON "Dispute"("organizationId", "providerReference");
CREATE UNIQUE INDEX "Dispute_organizationId_conversationId_debtRef_idempotencyKeyHash_key" ON "Dispute"("organizationId", "conversationId", "debtRef", "idempotencyKeyHash");
CREATE INDEX "Dispute_organizationId_conversationId_createdAt_idx" ON "Dispute"("organizationId", "conversationId", "createdAt");

ALTER TABLE "PaymentPromise" ADD CONSTRAINT "PaymentPromise_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentPromise" ADD CONSTRAINT "PaymentPromise_conversationId_organizationId_fkey"
FOREIGN KEY ("conversationId", "organizationId") REFERENCES "Conversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PaymentReport" ADD CONSTRAINT "PaymentReport_conversationId_organizationId_fkey"
FOREIGN KEY ("conversationId", "organizationId") REFERENCES "Conversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_conversationId_organizationId_fkey"
FOREIGN KEY ("conversationId", "organizationId") REFERENCES "Conversation"("id", "organizationId") ON DELETE CASCADE ON UPDATE CASCADE;
