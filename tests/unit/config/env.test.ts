import { describe, expect, it } from "vitest";

import { getRuntimeEnv } from "@/shared/config/env";

const validEnvironment = {
  NODE_ENV: "test" as const,
  APP_URL: "http://localhost:3000",
  CONVERSATION_SESSION_SECRET: "a-demo-secret-with-at-least-32-characters",
};

describe("getRuntimeEnv", () => {
  it("applies safe deterministic defaults", () => {
    const env = getRuntimeEnv(validEnvironment);

    expect(env.IDENTITY_MAX_ATTEMPTS).toBe(3);
    expect(env.CHAT_MAX_MESSAGE_LENGTH).toBe(1_200);
  });

  it("rejects a short session secret", () => {
    expect(() =>
      getRuntimeEnv({
        ...validEnvironment,
        CONVERSATION_SESSION_SECRET: "too-short",
      }),
    ).toThrow();
  });

  it("does not require an administrative secret", () => {
    const env = getRuntimeEnv(validEnvironment);

    expect(env.ADMIN_DEMO_SECRET).toBeUndefined();
  });
});
