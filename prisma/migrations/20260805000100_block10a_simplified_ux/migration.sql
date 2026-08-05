-- Additive UX fields for the sandbox scenario wizard. Existing rows receive
-- explicitly demonstrative defaults and remain isolated by their existing
-- organizationId relationships.
ALTER TABLE "SandboxIdentityProfile"
ADD COLUMN "scenarioName" VARCHAR(100) NOT NULL DEFAULT 'Cenário demonstrativo';

ALTER TABLE "SandboxDebtor"
ADD COLUMN "displayName" VARCHAR(80) NOT NULL DEFAULT 'Pessoa demonstrativa';
