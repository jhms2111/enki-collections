import { describe, expect, it } from "vitest";

import { demoIdentifierShortName, generateDemoIdentifier, isDemoIdentifier } from "@/shared/demo/demo-identifier";

describe("demo identifier canonical rule", () => {
  it("aceita fixtures históricas e o novo formato legível", () => {
    expect(isDemoIdentifier("DEMO-AURORA-001")).toBe(true);
    expect(isDemoIdentifier("DEMO-LUMEN-A7K2")).toBe(true);
    expect(isDemoIdentifier("DEMO-ABCDEF0123456789")).toBe(false);
  });
  it("normaliza somente o nome curto usado na geração", () => {
    expect(demoIdentifierShortName(" Cenário Lúmen fictício ")).toBe("LUMEN");
    expect(generateDemoIdentifier("Cenário Lúmen fictício")).toMatch(/^DEMO-LUMEN-[A-Z0-9]{4}$/);
  });
});
