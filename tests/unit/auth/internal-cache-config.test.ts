import { describe, expect, it } from "vitest";

import nextConfig, { buildContentSecurityPolicy } from "../../../next.config";

describe("Content-Security-Policy por ambiente", () => {
  it("permite eval somente no desenvolvimento local para suportar React Refresh", () => {
    expect(buildContentSecurityPolicy({ nodeEnv: "development" })).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );
  });

  it("não permite eval em produção", () => {
    expect(buildContentSecurityPolicy({ nodeEnv: "production" })).toContain(
      "script-src 'self' 'unsafe-inline';",
    );
    expect(buildContentSecurityPolicy({ nodeEnv: "production" })).not.toContain("'unsafe-eval'");
  });

  it.each([
    { nodeEnv: "production", vercel: "1", vercelEnv: "preview" },
    { nodeEnv: "development", vercel: "1", vercelEnv: "preview" },
    { nodeEnv: "development", vercel: "1", vercelEnv: "production" },
  ])("não permite eval em ambiente Vercel %#", (environment) => {
    expect(buildContentSecurityPolicy(environment)).not.toContain("'unsafe-eval'");
  });

  it("não libera origens ou domínios externos e preserva as demais diretivas", () => {
    const policy = buildContentSecurityPolicy({ nodeEnv: "development" });
    expect(policy).toBe(
      "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'",
    );
    expect(policy).not.toMatch(/https?:|wss?:|\*|localhost|127\.0\.0\.1/);
  });
});

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
    expect(globalHeaders.filter((header) => header.key !== "Content-Security-Policy")).toEqual([
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
      { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
    ]);
  });
});
