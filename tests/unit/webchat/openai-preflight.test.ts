import { afterEach, describe, expect, it, vi } from "vitest";

import { assertPreflightRequest, buildPreflightRequest, validateOpenAIPreflightConfig } from "@/modules/webchat/openai-preflight";
import { getRuntimeEnv } from "@/shared/config/env";

const source: NodeJS.ProcessEnv = {
  NODE_ENV: "development",
  APP_URL: "http://127.0.0.1:3000",
  DATABASE_URL: "postgresql://demo:demo@localhost:5432/demo",
  CONVERSATION_SESSION_SECRET: "conversation-session-secret-at-least-32-characters",
  IDEMPOTENCY_HMAC_SECRET: "dedicated-idempotency-secret-at-least-sixty-four-characters-0000",
  OPENAI_ENABLED: "true",
  OPENAI_MODEL: "gpt-5.6-luna",
  OPENAI_TIMEOUT_MS: "10000",
  OPENAI_TOTAL_DEADLINE_MS: "15000",
  OPENAI_MAX_RETRIES: "0",
  OPENAI_API_KEY: "entirely-fictitious-test-api-key",
  OPENAI_SAFETY_HMAC_SECRET: "s".repeat(64),
  OPENAI_MAX_CALLS_PER_CONVERSATION: "5",
  OPENAI_DAILY_BUDGET_USD: "0.5",
  OPENAI_MONTHLY_BUDGET_USD: "5",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OpenAI local preflight", () => {
  it("builds and validates the complete request without network", () => {
    vi.stubEnv("VERCEL", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const request = buildPreflightRequest(getRuntimeEnv(source));
    expect(() => assertPreflightRequest(request)).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(request.model).toBe("gpt-5.6-luna");
    expect(request).not.toHaveProperty("tools");
    expect(request).not.toHaveProperty("previous_response_id");
  });

  it.each([
    ["OPENAI_ENABLED", "false"],
    ["OPENAI_TIMEOUT_MS", "9999"],
    ["OPENAI_TOTAL_DEADLINE_MS", "14999"],
    ["OPENAI_MAX_RETRIES", "1"],
  ])("rejects a controlled value mismatch in %s", (field, value) => {
    vi.stubEnv("VERCEL", "");
    const env = getRuntimeEnv({ ...source, [field]: value });
    expect(() => validateOpenAIPreflightConfig(env)).toThrowError(expect.objectContaining({ field }));
  });

  it.each([
    ["OPENAI_MODEL", " "],
    ["OPENAI_API_KEY", ""],
    ["OPENAI_SAFETY_HMAC_SECRET", ""],
    ["OPENAI_MAX_CALLS_PER_CONVERSATION", "0"],
    ["OPENAI_DAILY_BUDGET_USD", "0"],
    ["OPENAI_MONTHLY_BUDGET_USD", "0"],
    ["OPENAI_MAX_OUTPUT_TOKENS", "10"],
    ["OPENAI_MAX_INPUT_TOKENS", "10"],
    ["OPENAI_CIRCUIT_FAILURE_THRESHOLD", "0"],
    ["OPENAI_CIRCUIT_OPEN_SECONDS", "1"],
  ])("rejects invalid schema input in %s", (field, value) => {
    expect(() => getRuntimeEnv({ ...source, [field]: value })).toThrow();
  });

  it("rejects an invalid timeout/deadline relationship", () => {
    expect(() => getRuntimeEnv({ ...source, OPENAI_TIMEOUT_MS: "10000", OPENAI_TOTAL_DEADLINE_MS: "10000" })).toThrow();
  });

  it("rejects a monthly budget below the daily budget", () => {
    expect(() => getRuntimeEnv({ ...source, OPENAI_DAILY_BUDGET_USD: "6", OPENAI_MONTHLY_BUDGET_USD: "5" })).toThrow();
  });

  it("rejects execution in a Vercel environment", () => {
    vi.stubEnv("VERCEL", "1");
    expect(() => validateOpenAIPreflightConfig(getRuntimeEnv(source))).toThrowError(expect.objectContaining({ field: "NODE_ENV" }));
  });
});
