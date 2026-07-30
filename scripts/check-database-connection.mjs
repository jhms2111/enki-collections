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
  const result = await pool.query("SELECT 1 AS healthy");
  if (result.rows[0]?.healthy !== 1) {
    throw new Error("A verificação de saúde retornou resultado inesperado.");
  }
} catch (error) {
  const safeError = {
    name: error instanceof Error ? error.name : "UnknownError",
    code:
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "string"
        ? error.code
        : "UNKNOWN",
  };
  process.stderr.write(`${JSON.stringify(safeError)}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
