DELETE FROM "IdempotencyRecord";

ALTER TABLE "IdempotencyRecord"
RENAME COLUMN "idempotencyKey" TO "idempotencyKeyHash";

ALTER TABLE "IdempotencyRecord"
ADD COLUMN "resourceRef" VARCHAR(320);

UPDATE "IdempotencyRecord"
SET "resourceRef" = 'legacy'
WHERE "resourceRef" IS NULL;

ALTER TABLE "IdempotencyRecord"
ALTER COLUMN "resourceRef" SET NOT NULL;

DROP INDEX "IdempotencyRecord_organizationId_operation_idempotencyKey_key";

CREATE UNIQUE INDEX "IdempotencyRecord_organizationId_operation_resourceRef_idempotencyKeyHash_key"
ON "IdempotencyRecord"(
  "organizationId",
  "operation",
  "resourceRef",
  "idempotencyKeyHash"
);

CREATE TABLE "OfferAcceptance" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "publicReference" VARCHAR(80) NOT NULL,
  "debtRef" VARCHAR(160) NOT NULL,
  "offerRef" VARCHAR(160) NOT NULL,
  "providerAcceptanceRef" VARCHAR(160) NOT NULL,
  "providerVersion" VARCHAR(160) NOT NULL,
  "termsSnapshot" JSONB NOT NULL,
  "idempotencyKeyHash" CHAR(64) NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OfferAcceptance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfferAcceptance_publicReference_key"
ON "OfferAcceptance"("publicReference");

CREATE UNIQUE INDEX "OfferAcceptance_organizationId_providerAcceptanceRef_key"
ON "OfferAcceptance"("organizationId", "providerAcceptanceRef");

CREATE UNIQUE INDEX "OfferAcceptance_organizationId_conversationId_offerRef_idempotencyKeyHash_key"
ON "OfferAcceptance"(
  "organizationId",
  "conversationId",
  "offerRef",
  "idempotencyKeyHash"
);

CREATE INDEX "OfferAcceptance_organizationId_conversationId_acceptedAt_idx"
ON "OfferAcceptance"("organizationId", "conversationId", "acceptedAt");

ALTER TABLE "OfferAcceptance"
ADD CONSTRAINT "OfferAcceptance_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "OfferAcceptance"
ADD CONSTRAINT "OfferAcceptance_conversationId_organizationId_fkey"
FOREIGN KEY ("conversationId", "organizationId")
REFERENCES "Conversation"("id", "organizationId")
ON DELETE CASCADE ON UPDATE CASCADE;
