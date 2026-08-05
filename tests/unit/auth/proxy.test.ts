import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";

import { proxy } from "@/proxy";
import {
  encodeDemoAccessState,
  hashDemoAccessCode,
} from "@/shared/auth/demo-access";

const secret =
  "proxy-access-test-secret-with-at-least-sixty-four-characters-00000000";

beforeEach(() => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.DEMO_ACCESS_HMAC_SECRET = secret;
  process.env.DEMO_ACCESS_CODE_HASH = hashDemoAccessCode("demo-code", secret);
});

afterEach(() => {
  delete process.env.DEMO_ACCESS_HMAC_SECRET;
  delete process.env.DEMO_ACCESS_CODE_HASH;
});

describe("production proxy foundation", () => {
  it("redirects an unauthenticated page and rejects an unauthenticated API", async () => {
    const page = await proxy(
      new NextRequest("http://localhost:3000/demo/jf-demo"),
    );
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toContain("/demo-access");

    const api = await proxy(
      new NextRequest(
        "http://localhost:3000/api/v1/public/conversations/conv_test",
      ),
    );
    expect(api.status).toBe(401);
    expect(api.headers.get("cache-control")).toBe("no-store");
  });

  it("accepts only a valid signed authorization cookie", async () => {
    const cookie = encodeDemoAccessState(
      {
        authorized: true,
        failedAttempts: 0,
        windowStartedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
      secret,
    );
    const response = await proxy(
      new NextRequest("http://localhost:3000/demo/jf-demo", {
        headers: { Cookie: `enki_demo_access=${cookie}` },
      }),
    );
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("rejects mutations without the exact configured Origin and Host", async () => {
    const missingOrigin = await proxy(
      new NextRequest(
        "http://localhost:3000/api/v1/demo-access/authenticate",
        { method: "POST", headers: { Host: "localhost:3000" } },
      ),
    );
    expect(missingOrigin.status).toBe(403);

    const foreignOrigin = await proxy(
      new NextRequest(
        "http://localhost:3000/api/v1/demo-access/authenticate",
        {
          method: "POST",
          headers: {
            Host: "localhost:3000",
            Origin: "https://evil.example",
          },
        },
      ),
    );
    expect(foreignOrigin.status).toBe(403);

    const valid = await proxy(
      new NextRequest(
        "http://localhost:3000/api/v1/demo-access/authenticate",
        {
          method: "POST",
          headers: {
            Host: "localhost:3000",
            Origin: "http://localhost:3000",
          },
        },
      ),
    );
    expect(valid.headers.get("x-middleware-next")).toBe("1");
  });

  it("separa a área interna dos cookies da demonstração", async () => {
    const withoutInternalSession = await proxy(
      new NextRequest("http://localhost:3000/internal"),
    );
    expect(withoutInternalSession.status).toBe(307);
    expect(withoutInternalSession.headers.get("location")).toContain(
      "/internal-access",
    );

    const demoCookie = encodeDemoAccessState(
      {
        authorized: true,
        failedAttempts: 0,
        windowStartedAt: Date.now(),
        expiresAt: Date.now() + 60_000,
      },
      secret,
    );
    const demoIsNotInternal = await proxy(
      new NextRequest("http://localhost:3000/api/v1/internal/scenarios", {
        headers: { Cookie: `enki_demo_access=${demoCookie}` },
      }),
    );
    expect(demoIsNotInternal.status).toBe(401);

    const internalCookieContinuesToServerValidation = await proxy(
      new NextRequest("http://localhost:3000/internal", {
        headers: { Cookie: "enki_internal_session=opaque-test-token" },
      }),
    );
    expect(
      internalCookieContinuesToServerValidation.headers.get(
        "x-middleware-next",
      ),
    ).toBe("1");
    expect(internalCookieContinuesToServerValidation.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("aplica cache privado à página de acesso e ao redirecionamento interno", async () => {
    const access = await proxy(new NextRequest("http://localhost:3000/internal-access"));
    expect(access.headers.get("cache-control")).toBe("private, no-store, max-age=0");

    const redirect = await proxy(new NextRequest("http://localhost:3000/internal/settings"));
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toContain("/internal-access");
    expect(redirect.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
});
