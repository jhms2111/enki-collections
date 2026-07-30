import { createHmac, randomBytes, randomUUID } from "node:crypto";

export const conversationCookieName = "enki_session";

export type SessionCookieOptions = Readonly<{
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
}>;

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}

export function generatePublicReference(): string {
  return `conv_${randomUUID().replaceAll("-", "")}`;
}

export function sessionCookieOptions(
  isProduction: boolean,
  maxAge: number,
): SessionCookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge,
  };
}
