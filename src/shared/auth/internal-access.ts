import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const internalSessionCookieName = "enki_internal_session";
export const internalAttemptCookieName = "enki_internal_attempts";

const internalEnvSchema = z.object({
  INTERNAL_ACCESS_CODE_HASH: z.string().regex(/^[a-f0-9]{64}$/),
  INTERNAL_ACCESS_HMAC_SECRET: z.string().min(64),
  INTERNAL_SESSION_MAX_AGE_SECONDS: z.coerce.number().int().min(300).max(28_800).default(14_400),
  INTERNAL_ACCESS_MAX_ATTEMPTS: z.coerce.number().int().min(2).max(10).default(5),
  INTERNAL_ACCESS_WINDOW_SECONDS: z.coerce.number().int().min(60).max(3_600).default(600),
});

export function getInternalAccessEnv(source: NodeJS.ProcessEnv = process.env) {
  return internalEnvSchema.parse(source);
}

export function hashInternalAccessCode(code: string, secret: string): string {
  return createHmac("sha256", secret).update(`internal-access-code:v1:${code}`).digest("hex");
}

export function verifyInternalAccessCode(code: string, expected: string, secret: string): boolean {
  const actual = Buffer.from(hashInternalAccessCode(code, secret), "hex");
  const target = Buffer.from(expected, "hex");
  return actual.length === target.length && timingSafeEqual(actual, target);
}

export function createInternalSessionToken() {
  return randomBytes(48).toString("base64url");
}

export function hashInternalSessionToken(token: string) {
  return createHash("sha256").update(`internal-session:v1:${token}`).digest("hex");
}

export function internalCookieOptions(secure: boolean, maxAge: number) {
  return { httpOnly: true as const, sameSite: "strict" as const, secure, path: "/", maxAge };
}

export type InternalAttemptState = { failedAttempts: number; expiresAt: number };
export function encodeInternalAttempts(state: InternalAttemptState, secret: string) {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`internal-attempts:v1:${payload}`).digest("base64url");
  return `${payload}.${signature}`;
}
export function decodeInternalAttempts(value: string | undefined, secret: string, now: Date): InternalAttemptState | null {
  if (!value) return null; const [payload, signature, extra] = value.split("."); if (!payload || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(`internal-attempts:v1:${payload}`).digest(); const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { const parsed = z.object({ failedAttempts: z.number().int().min(0).max(10), expiresAt: z.number().int().positive() }).strict().parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))); return parsed.expiresAt > now.getTime() ? parsed : null; } catch { return null; }
}
