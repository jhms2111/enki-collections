import { describe, expect, it } from "vitest";

import { deriveAiOperationalIdentity, estimateOpenAiCostMicrousd } from "@/modules/webchat/ai-operational-identity";

describe("AI operational identity", () => {
  it("derives stable domain-separated pseudonyms without exposing internal references", () => {
    const input = {
      secret: "s".repeat(64), organizationId: "org-internal", conversationId: "conversation-internal", clientTurnId: "turn-internal",
    };
    const first = deriveAiOperationalIdentity(input);
    expect(deriveAiOperationalIdentity(input)).toEqual(first);
    expect(new Set(Object.values(first)).size).toBe(3);
    for (const value of Object.values(first)) {
      expect(value).toMatch(/^[a-f0-9]{64}$/);
      expect(value).not.toContain("internal");
    }
  });

  it("uses the official Luna token prices in microdollars", () => {
    expect(estimateOpenAiCostMicrousd(1_000_000, 1_000_000)).toBe(BigInt(7_000_000));
  });
});
