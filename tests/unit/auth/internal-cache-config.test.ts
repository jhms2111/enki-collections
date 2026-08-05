import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";

describe("internal HTML cache configuration", () => {
  it("aplica private no-store somente às páginas HTML internas", async () => {
    const rules = await nextConfig.headers?.();
    const internalRules = rules?.filter((rule) => rule.source === "/internal-access" || rule.source === "/internal/:path*");
    expect(internalRules).toHaveLength(2);
    for (const rule of internalRules ?? []) {
      expect(rule.headers).toContainEqual({ key: "Cache-Control", value: "private, no-store, max-age=0" });
    }
    expect(rules?.find((rule) => rule.source.includes("_next/static"))).toBeUndefined();
  });
});
