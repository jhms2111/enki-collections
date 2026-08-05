import { describe, expect, it } from "vitest";

import { shouldOpenAiCircuit } from "@/modules/webchat/prisma-ai-operational-store";

describe("AI circuit breaker policy", () => {
  it("opens immediately for authentication and quota failures", () => {
    expect(shouldOpenAiCircuit("AUTHENTICATION", 1, 5)).toBe(true);
    expect(shouldOpenAiCircuit("QUOTA", 1, 5)).toBe(true);
  });

  it("opens temporary failures only at the configured threshold", () => {
    expect(shouldOpenAiCircuit("TIMEOUT", 4, 5)).toBe(false);
    expect(shouldOpenAiCircuit("TIMEOUT", 5, 5)).toBe(true);
  });
});
