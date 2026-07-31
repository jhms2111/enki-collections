import { describe, expect, it } from "vitest";

import {
  decodeDemoAccessState,
  demoAccessCookieOptions,
  encodeDemoAccessState,
  hashDemoAccessCode,
  verifyDemoAccessCode,
} from "@/shared/auth/demo-access";

const secret =
  "demo-access-test-secret-with-at-least-sixty-four-characters-000000000";
const now = new Date("2026-07-31T10:00:00.000Z");

describe("demo access authentication", () => {
  it("validates the code by a dedicated HMAC without storing it in the hash", () => {
    const code = "prototype-only-code";
    const hash = hashDemoAccessCode(code, secret);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(code);
    expect(verifyDemoAccessCode(code, hash, secret)).toBe(true);
    expect(verifyDemoAccessCode("incorrect-code", hash, secret)).toBe(false);
  });

  it("signs access state and rejects tampering, expiry and another secret", () => {
    const state = {
      authorized: true,
      failedAttempts: 0,
      windowStartedAt: now.getTime(),
      expiresAt: now.getTime() + 60_000,
    };
    const encoded = encodeDemoAccessState(state, secret);
    expect(decodeDemoAccessState(encoded, secret, now)).toEqual(state);
    expect(
      decodeDemoAccessState(`${encoded}x`, secret, now),
    ).toBeNull();
    expect(
      decodeDemoAccessState(
        encoded,
        `${secret}-another`,
        now,
      ),
    ).toBeNull();
    expect(
      decodeDemoAccessState(
        encoded,
        secret,
        new Date(now.getTime() + 60_001),
      ),
    ).toBeNull();
  });

  it("uses HttpOnly, SameSite=Lax and Secure only in production", () => {
    expect(demoAccessCookieOptions(true, 600)).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 600,
    });
    expect(demoAccessCookieOptions(false, 600).secure).toBe(false);
  });
});
