import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "@/app/api/v1/demo-access/authenticate/route";
import { hashDemoAccessCode } from "@/shared/auth/demo-access";

const secret =
  "route-access-test-secret-with-at-least-sixty-four-characters-00000000";
const code = "valid-prototype-code";
const saved = {
  hash: process.env.DEMO_ACCESS_CODE_HASH,
  secret: process.env.DEMO_ACCESS_HMAC_SECRET,
  attempts: process.env.DEMO_ACCESS_MAX_ATTEMPTS,
  window: process.env.DEMO_ACCESS_WINDOW_SECONDS,
  maxAge: process.env.DEMO_ACCESS_COOKIE_MAX_AGE_SECONDS,
  vercelEnv: process.env.VERCEL_ENV,
};

beforeEach(() => {
  process.env.DEMO_ACCESS_CODE_HASH = hashDemoAccessCode(code, secret);
  process.env.DEMO_ACCESS_HMAC_SECRET = secret;
  process.env.DEMO_ACCESS_MAX_ATTEMPTS = "3";
  process.env.DEMO_ACCESS_WINDOW_SECONDS = "600";
  process.env.DEMO_ACCESS_COOKIE_MAX_AGE_SECONDS = "3600";
});

afterEach(() => {
  for (const [name, value] of Object.entries({
    DEMO_ACCESS_CODE_HASH: saved.hash,
    DEMO_ACCESS_HMAC_SECRET: saved.secret,
    DEMO_ACCESS_MAX_ATTEMPTS: saved.attempts,
    DEMO_ACCESS_WINDOW_SECONDS: saved.window,
    DEMO_ACCESS_COOKIE_MAX_AGE_SECONDS: saved.maxAge,
    VERCEL_ENV: saved.vercelEnv,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function request(inputCode: string, cookie?: string) {
  return new Request("http://localhost:3000/api/v1/demo-access/authenticate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({
      code: inputCode,
      returnTo: "/demo/jf-demo",
    }),
  });
}

function cookieFrom(response: Response) {
  return response.headers.get("set-cookie")?.split(";")[0];
}

describe("demo access route", () => {
  it("limits consecutive failures with a signed cookie and returns 429", async () => {
    let cookie: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const response = await POST(request("incorrect-code", cookie));
      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("incorrect-code");
      cookie = cookieFrom(response);
    }
    const limited = await POST(request("incorrect-code", cookie));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(await limited.text()).not.toContain("incorrect-code");
  });

  it("sets a secure HttpOnly cookie in production without exposing the code", async () => {
    process.env.VERCEL_ENV = "production";
    const response = await POST(request(code));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      redirectTo: "/demo/jf-demo",
    });
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    expect(cookie).not.toContain(code);
  });

  it("does not allow an external return URL", async () => {
    const response = await POST(
      new Request(
        "http://localhost:3000/api/v1/demo-access/authenticate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code,
            returnTo: "https://example.com/steal",
          }),
        },
      ),
    );
    expect(await response.json()).toEqual({
      redirectTo: "/demo/jf-demo",
    });
  });
});
