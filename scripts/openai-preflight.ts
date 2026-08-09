import { config } from "dotenv";

config({ path: [".env.local", ".env"], override: false, quiet: true });

async function main() {
  const originalFetch = globalThis.fetch;
  let fetchAttempts = 0;
  globalThis.fetch = (async () => {
    fetchAttempts += 1;
    throw new Error("PREFLIGHT_HTTP_BLOCKED");
  }) as typeof fetch;

  try {
    const [{ getRuntimeEnv }, { getPrisma }, preflight] = await Promise.all([
      import("../src/shared/config/env"),
      import("../src/shared/database/prisma"),
      import("../src/modules/webchat/openai-preflight"),
    ]);
    const env = getRuntimeEnv();
    const request = preflight.buildPreflightRequest(env);
    preflight.assertPreflightRequest(request);

    const prisma = getPrisma();
    const tableCounts = {
      AiTurnExecution: await prisma.aiTurnExecution.count(),
      AiBudgetPeriod: await prisma.aiBudgetPeriod.count(),
      AiCircuitBreaker: await prisma.aiCircuitBreaker.count(),
    };
    const migrations = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
      SELECT migration_name, finished_at, rolled_back_at
      FROM _prisma_migrations
      WHERE migration_name = '20260806000100_block11b2_ai_operations'
    `;
    await prisma.$disconnect();
    if (migrations.length !== 1 || !migrations[0]?.finished_at || migrations[0].rolled_back_at) {
      throw new preflight.OpenAIPreflightError("PRISMA_MIGRATION", "A migração operacional de IA não está atualizada.");
    }
    if (fetchAttempts !== 0) throw new preflight.OpenAIPreflightError("HTTP", "O preflight tentou iniciar HTTP.");

    process.stdout.write(JSON.stringify({
      ok: true,
      localOnly: true,
      openAiEnabled: true,
      apiKeyPresent: true,
      safetySecretPresent: true,
      model: env.OPENAI_MODEL,
      timeoutMs: env.OPENAI_TIMEOUT_MS,
      totalDeadlineMs: env.OPENAI_TOTAL_DEADLINE_MS,
      maxRetries: env.OPENAI_MAX_RETRIES,
      maxCallsPerConversation: env.OPENAI_MAX_CALLS_PER_CONVERSATION,
      dailyBudgetUsd: env.OPENAI_DAILY_BUDGET_USD,
      monthlyBudgetUsd: env.OPENAI_MONTHLY_BUDGET_USD,
      payloadBuilt: true,
      strictJsonSchema: true,
      tablesAccessible: Object.keys(tableCounts),
      migrationCurrent: true,
      fetchAttempts,
    }, null, 2));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

main().catch((error: unknown) => {
  const safe = error as { name?: unknown; field?: unknown; message?: unknown };
  process.stderr.write(JSON.stringify({
    ok: false,
    name: typeof safe.name === "string" ? safe.name : "Error",
    field: typeof safe.field === "string" ? safe.field : undefined,
    message: typeof safe.message === "string" ? safe.message : "Falha segura no preflight.",
  }));
  process.exitCode = 1;
});
