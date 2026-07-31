import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

export const demoAccessCookieName = "enki_demo_access";

const demoAccessEnvSchema = z
  .object({
    DEMO_ACCESS_CODE_HASH: z.string().regex(/^[a-f0-9]{64}$/),
    DEMO_ACCESS_HMAC_SECRET: z.string().min(64),
    DEMO_ACCESS_MAX_ATTEMPTS: z.coerce.number().int().min(2).max(20).default(5),
    DEMO_ACCESS_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3_600)
      .default(600),
    DEMO_ACCESS_COOKIE_MAX_AGE_SECONDS: z.coerce
      .number()
      .int()
      .min(300)
      .max(86_400)
      .default(28_800),
  });

export type DemoAccessEnv = z.infer<typeof demoAccessEnvSchema>;

export type DemoAccessState = Readonly<{
  authorized: boolean;
  failedAttempts: number;
  windowStartedAt: number;
  expiresAt: number;
}>;

export function getDemoAccessEnv(
  source: NodeJS.ProcessEnv = process.env,
): DemoAccessEnv {
  return demoAccessEnvSchema.parse(source);
}

function sign(value: string, secret: string, domain: string): Buffer {
  return createHmac("sha256", secret)
    .update(`${domain}:${value}`)
    .digest();
}

export function hashDemoAccessCode(code: string, secret: string): string {
  return sign(code, secret, "demo-access-code:v1").toString("hex");
}

export function verifyDemoAccessCode(
  code: string,
  expectedHash: string,
  secret: string,
): boolean {
  const actual = Buffer.from(hashDemoAccessCode(code, secret), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function encodeDemoAccessState(
  state: DemoAccessState,
  secret: string,
): string {
  const payload = Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature = sign(payload, secret, "demo-access-cookie:v1").toString(
    "base64url",
  );
  return `${payload}.${signature}`;
}

export function decodeDemoAccessState(
  value: string | undefined,
  secret: string,
  now: Date,
): DemoAccessState | null {
  if (!value) return null;
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) return null;
  const expected = sign(payload, secret, "demo-access-cookie:v1");
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }
  try {
    const parsed = z
      .object({
        authorized: z.boolean(),
        failedAttempts: z.number().int().min(0).max(20),
        windowStartedAt: z.number().int().nonnegative(),
        expiresAt: z.number().int().positive(),
      })
      .strict()
      .parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    return parsed.expiresAt > now.getTime() ? parsed : null;
  } catch {
    return null;
  }
}

export function demoAccessCookieOptions(
  secure: boolean,
  maxAge: number,
) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure,
    path: "/",
    maxAge,
  };
}
