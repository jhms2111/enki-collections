import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Block 11B.2 migration privacy", () => {
  it("is additive and stores only sanitized operational fields", () => {
    const sql = readFileSync("prisma/migrations/20260806000100_block11b2_ai_operations/migration.sql", "utf8");
    expect(sql).not.toMatch(/^\s*(?:DROP|DELETE|TRUNCATE|RENAME)\b/im);
    expect(sql).toContain("conversationKeyHash");
    expect(sql).toContain("clientTurnKeyHash");
    expect(sql).toContain("publicResponse");
    expect(sql).not.toMatch(/\b(?:prompt|userMessage|rawResponse|cookie|apiKey|demoIdentifier|financialFacts)\b/i);
    expect(sql).toContain("AiTurnExecution_organizationId_conversationKeyHash_clientTurnKeyHash_key");
  });
});
