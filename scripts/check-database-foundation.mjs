import "dotenv/config";

import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL não está configurada.");
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
});

try {
  const organization = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM "Organization"
     WHERE "slug" = $1 AND "name" = $2`,
    ["jf-demo", "JF Demo — Organização Fictícia"],
  );
  const allowedTables = await pool.query(
    `SELECT tablename
     FROM pg_catalog.pg_tables
     WHERE schemaname = 'public'
       AND tablename = ANY($1::text[])`,
    [[
      "Organization",
      "Conversation",
      "Message",
      "AuditEvent",
      "IdempotencyRecord",
      "OfferAcceptance",
      "PaymentPromise",
      "PaymentReport",
      "Dispute",
    ]],
  );
  const forbiddenTables = await pool.query(
    `SELECT tablename
     FROM pg_catalog.pg_tables
     WHERE schemaname = 'public'
       AND lower(tablename) = ANY($1::text[])`,
    [["debtor", "debt", "authorizedoffer", "payment", "paymentinstrument"]],
  );
  const providerContextColumn = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'Conversation'
       AND column_name = 'verifiedDebtorContext'
       AND data_type = 'jsonb'`,
  );
  const idempotencyHashColumns = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (
         (table_name = 'IdempotencyRecord'
          AND column_name = 'idempotencyKeyHash')
         OR
         (table_name = 'OfferAcceptance'
          AND column_name = 'idempotencyKeyHash')
         OR
         (table_name = 'PaymentPromise'
          AND column_name = 'idempotencyKeyHash')
         OR
         (table_name = 'PaymentReport'
          AND column_name = 'idempotencyKeyHash')
         OR
         (table_name = 'Dispute'
          AND column_name = 'idempotencyKeyHash')
       )`,
  );
  const plaintextIdempotencyColumns = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND column_name = 'idempotencyKey'`,
  );
  const sandboxCounts = await pool.query(
    `SELECT 'SandboxCreditor' AS table_name, COUNT(*)::int AS count FROM "SandboxCreditor"
     UNION ALL SELECT 'SandboxIdentityProfile', COUNT(*)::int FROM "SandboxIdentityProfile"
     UNION ALL SELECT 'SandboxIdentityChallenge', COUNT(*)::int FROM "SandboxIdentityChallenge"
     UNION ALL SELECT 'SandboxIdentityChallengeOption', COUNT(*)::int FROM "SandboxIdentityChallengeOption"
     UNION ALL SELECT 'SandboxDebtor', COUNT(*)::int FROM "SandboxDebtor"
     UNION ALL SELECT 'SandboxDebt', COUNT(*)::int FROM "SandboxDebt"
     UNION ALL SELECT 'SandboxAuthorizedOffer', COUNT(*)::int FROM "SandboxAuthorizedOffer"
     UNION ALL SELECT 'InternalSession', COUNT(*)::int FROM "InternalSession"
     UNION ALL SELECT 'InternalAuditEvent', COUNT(*)::int FROM "InternalAuditEvent"
     ORDER BY table_name`,
  );
  const nonDemoSandboxRows = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM "SandboxCreditor" WHERE "isDemo" IS NOT TRUE) +
       (SELECT COUNT(*) FROM "SandboxIdentityProfile" WHERE "isDemo" IS NOT TRUE) +
       (SELECT COUNT(*) FROM "SandboxIdentityChallenge" WHERE "isDemo" IS NOT TRUE) +
       (SELECT COUNT(*) FROM "SandboxIdentityChallengeOption" WHERE "isDemo" IS NOT TRUE) +
       (SELECT COUNT(*) FROM "SandboxDebtor" WHERE "isDemo" IS NOT TRUE) +
       (SELECT COUNT(*) FROM "SandboxDebt" WHERE "isDemo" IS NOT TRUE) +
       (SELECT COUNT(*) FROM "SandboxAuthorizedOffer" WHERE "isDemo" IS NOT TRUE) AS count`,
  );
  const sandboxScenarios = await pool.query(
    `SELECT o.slug, p."demoIdentifier", p."scenarioName", d."displayName"
     FROM "SandboxIdentityProfile" p
     JOIN "Organization" o ON o.id = p."organizationId"
     JOIN "SandboxDebtor" d ON d."identityProfileId" = p.id AND d."organizationId" = p."organizationId"
     WHERE o.slug = ANY($1::text[])
     ORDER BY o.slug, p."demoIdentifier"`,
    [["jf-demo", "atlas-demo"]],
  );

  const healthy =
    organization.rows[0]?.count === 1 &&
    allowedTables.rowCount === 9 &&
    forbiddenTables.rowCount === 0 &&
    providerContextColumn.rows[0]?.count === 1 &&
    idempotencyHashColumns.rows[0]?.count === 5 &&
    plaintextIdempotencyColumns.rows[0]?.count === 0 &&
    sandboxCounts.rowCount === 9 &&
    nonDemoSandboxRows.rows[0]?.count === "0" &&
    sandboxScenarios.rowCount > 0 &&
    sandboxScenarios.rows.every((row) =>
      row.demoIdentifier.startsWith("DEMO-") &&
      row.scenarioName.trim().length >= 3 &&
      row.displayName.trim().length >= 3
    );

  if (!healthy) {
    throw new Error("A fundação persistida não corresponde ao escopo aprovado.");
  }

  process.stdout.write(
    JSON.stringify({
      demoOrganizations: organization.rows[0].count,
      allowedTables: allowedTables.rowCount,
      forbiddenFinancialTables: forbiddenTables.rowCount,
      verifiedProviderContextColumns:
        providerContextColumn.rows[0].count,
      idempotencyHashColumns: idempotencyHashColumns.rows[0].count,
      plaintextIdempotencyColumns:
        plaintextIdempotencyColumns.rows[0].count,
      sandboxCounts: Object.fromEntries(sandboxCounts.rows.map((row) => [row.table_name, row.count])),
      nonDemoSandboxRows: Number(nonDemoSandboxRows.rows[0].count),
      sandboxScenarios: sandboxScenarios.rows,
    }) + "\n",
  );
} catch (error) {
  const safeError = {
    name: error instanceof Error ? error.name : "UnknownError",
    code:
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "FOUNDATION_CHECK_FAILED",
  };
  process.stderr.write(`${JSON.stringify(safeError)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
