import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "@/proxy";

beforeEach(() => {
  process.env.APP_URL = "http://localhost:3000";
});

afterEach(() => {
  delete process.env.APP_URL;
  delete process.env.VERCEL_ENV;
});

describe("public and internal proxy boundaries", () => {
  it.each(["development", "preview", "production"])(
    "opens the public portal and webchat without an access gate in %s",
    async (environment) => {
      process.env.VERCEL_ENV = environment;
      for (const path of ["/demo/jf-demo", "/demo/jf-demo/chat"]) {
        const response = await proxy(new NextRequest(`http://localhost:3000${path}`));
        expect(response.headers.get("x-middleware-next")).toBe("1");
        expect(response.headers.get("location")).toBeNull();
      }
    },
  );

  it("lets public conversation APIs reach their own session validation", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3000/api/v1/public/conversations/conv_test"),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects mutations without the exact configured Origin and Host", async () => {
    const url = "http://localhost:3000/api/v1/public/organizations/jf-demo/conversations";
    const missingOrigin = await proxy(
      new NextRequest(url, { method: "POST", headers: { Host: "localhost:3000" } }),
    );
    expect(missingOrigin.status).toBe(403);

    const foreignOrigin = await proxy(
      new NextRequest(url, {
        method: "POST",
        headers: { Host: "localhost:3000", Origin: "https://evil.example" },
      }),
    );
    expect(foreignOrigin.status).toBe(403);

    const valid = await proxy(
      new NextRequest(url, {
        method: "POST",
        headers: { Host: "localhost:3000", Origin: "http://localhost:3000" },
      }),
    );
    expect(valid.headers.get("x-middleware-next")).toBe("1");
  });

  it("keeps internal pages and APIs protected by their own session", async () => {
    const page = await proxy(new NextRequest("http://localhost:3000/internal"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/internal-access");
    expect(page.headers.get("cache-control")).toBe("private, no-store, max-age=0");

    const api = await proxy(
      new NextRequest("http://localhost:3000/api/v1/internal/scenarios"),
    );
    expect(api.status).toBe(401);
    expect(api.headers.get("cache-control")).toBe("no-store");
  });

  it("does not accept a legacy public cookie as internal authentication", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3000/api/v1/internal/scenarios", {
        headers: { Cookie: "enki_demo_access=legacy-signed-value" },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("allows only the internal cookie to continue to server-side validation", async () => {
    const response = await proxy(
      new NextRequest("http://localhost:3000/internal", {
        headers: { Cookie: "enki_internal_session=opaque-test-token" },
      }),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("keeps the internal access page private and uncached", async () => {
    const response = await proxy(new NextRequest("http://localhost:3000/internal-access"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
});
