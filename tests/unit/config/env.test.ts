import { describe, expect, it } from "vitest";

import { getRuntimeEnv } from "@/shared/config/env";

const validEnvironment = {
  NODE_ENV: "test" as const,
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgresql://demo:demo@localhost:5432/demo",
  CONVERSATION_SESSION_SECRET: "a-demo-secret-with-at-least-32-characters",
  IDEMPOTENCY_HMAC_SECRET:
    "a-dedicated-idempotency-secret-with-at-least-sixty-four-characters-000",
};

describe("getRuntimeEnv", () => {
  it("applies safe deterministic defaults", () => {
    const env = getRuntimeEnv(validEnvironment);

    expect(env.IDENTITY_MAX_ATTEMPTS).toBe(3);
    expect(env.CHAT_MAX_MESSAGE_LENGTH).toBe(1_200);
    expect(env.OPENAI_ENABLED).toBe(false);
    expect(env.OPENAI_MODEL).toBe("gpt-5.6-luna");
    expect(env.OPENAI_MAX_CALLS_PER_CONVERSATION).toBe(5);
    expect(env.OPENAI_DAILY_BUDGET_USD).toBe(0.5);
    expect(env.OPENAI_MONTHLY_BUDGET_USD).toBe(5);
    expect(env.OPENAI_TIMEOUT_MS).toBe(10_000);
    expect(env.OPENAI_TOTAL_DEADLINE_MS).toBe(15_000);
    expect(env.OPENAI_MAX_RETRIES).toBe(0);
    expect(env.OPENAI_MAX_OUTPUT_TOKENS).toBe(200);
  });

  it("rejects a short session secret", () => {
    expect(() =>
      getRuntimeEnv({
        ...validEnvironment,
        CONVERSATION_SESSION_SECRET: "too-short",
      }),
    ).toThrow();
  });

  it("requires a long, dedicated idempotency secret", () => {
    expect(() =>
      getRuntimeEnv({
        ...validEnvironment,
        IDEMPOTENCY_HMAC_SECRET: "too-short",
      }),
    ).toThrow();
    expect(() =>
      getRuntimeEnv({
        ...validEnvironment,
        CONVERSATION_SESSION_SECRET:
          validEnvironment.IDEMPOTENCY_HMAC_SECRET,
      }),
    ).toThrow();
  });

  it("does not require an administrative secret", () => {
    const env = getRuntimeEnv(validEnvironment);

    expect(env.ADMIN_DEMO_SECRET).toBeUndefined();
  });

  it("requires a dedicated key and safety secret only when OpenAI is enabled", () => {
    expect(() => getRuntimeEnv({ ...validEnvironment, OPENAI_ENABLED: "true" })).toThrow();
    const env = getRuntimeEnv({
      ...validEnvironment,
      OPENAI_ENABLED: "true",
      OPENAI_API_KEY: "entirely-fictitious-test-api-key",
      OPENAI_SAFETY_HMAC_SECRET: "s".repeat(64),
    });
    expect(env.OPENAI_ENABLED).toBe(true);
  });

  it("accepts the authorized 15 second total OpenAI deadline", () => {
    expect(getRuntimeEnv({ ...validEnvironment, OPENAI_TOTAL_DEADLINE_MS: "15000" }).OPENAI_TOTAL_DEADLINE_MS).toBe(15_000);
  });
});
