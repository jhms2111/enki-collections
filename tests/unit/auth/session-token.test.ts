import { describe, expect, it } from "vitest";

import {
  generateSessionToken,
  hashSessionToken,
  sessionCookieOptions,
} from "@/shared/auth/session-token";

describe("session token", () => {
  it("generates strong opaque tokens and stable non-reversible hashes", () => {
    const token = generateSessionToken();
    const hash = hashSessionToken(
      token,
      "a-session-secret-with-at-least-32-characters",
    );

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
  });

  it("uses HttpOnly, SameSite Lax and environment-aware Secure", () => {
    expect(sessionCookieOptions(false, 3_600)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: false,
      path: "/",
      maxAge: 3_600,
    });
    expect(sessionCookieOptions(true, 3_600).secure).toBe(true);
  });
});
