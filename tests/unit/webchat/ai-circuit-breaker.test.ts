import { describe, expect, it } from "vitest";

import { aiCircuitCompletionAction, shouldOpenAiCircuit } from "@/modules/webchat/prisma-ai-operational-store";

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

describe("AI circuit completion semantics", () => {
  it("resets after a complete provider success", () => {
    expect(aiCircuitCompletionAction(undefined)).toBe("RESET");
  });

  it("resets after valid Structured Output subsequently blocked by policy", () => {
    expect(aiCircuitCompletionAction("POLICY")).toBe("RESET");
  });

  it("resets a timeout sequence after the next success", () => {
    expect(aiCircuitCompletionAction("UNKNOWN_OUTCOME")).toBe("FAILURE");
    expect(aiCircuitCompletionAction(undefined)).toBe("RESET");
  });

  it("resets an HTTP error sequence after the next success", () => {
    expect(aiCircuitCompletionAction("SERVER_ERROR")).toBe("FAILURE");
    expect(aiCircuitCompletionAction(undefined)).toBe("RESET");
  });

  it("leaves the circuit unchanged for fallback without a provider call", () => {
    expect(aiCircuitCompletionAction(undefined, false)).toBe("UNCHANGED");
  });
});
