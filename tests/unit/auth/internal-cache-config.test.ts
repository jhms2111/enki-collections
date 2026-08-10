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

  it("mantém no-store na demonstração e os headers globais de segurança e indexação", async () => {
    const rules = await nextConfig.headers?.();
    expect(rules?.find((rule) => rule.source === "/demo/:path*")?.headers).toContainEqual({
      key: "Cache-Control",
      value: "no-store, max-age=0",
    });
    const globalHeaders = rules?.find((rule) => rule.source === "/(.*)")?.headers ?? [];
    expect(globalHeaders).toContainEqual({
      key: "X-Robots-Tag",
      value: "noindex, nofollow, noarchive, nosnippet",
    });
    expect(globalHeaders).toContainEqual({ key: "X-Frame-Options", value: "DENY" });
    expect(globalHeaders).toContainEqual({ key: "X-Content-Type-Options", value: "nosniff" });
    expect(globalHeaders.some((header) => header.key === "Content-Security-Policy")).toBe(true);
  });
});
