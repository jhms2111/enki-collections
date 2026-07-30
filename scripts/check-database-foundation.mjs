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

  const healthy =
    organization.rows[0]?.count === 1 &&
    allowedTables.rowCount === 5 &&
    forbiddenTables.rowCount === 0 &&
    providerContextColumn.rows[0]?.count === 1;

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
