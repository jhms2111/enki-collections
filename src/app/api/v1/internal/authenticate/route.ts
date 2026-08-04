import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { getPrisma } from "@/shared/database/prisma";
import { createInternalSessionToken, decodeInternalAttempts, encodeInternalAttempts, getInternalAccessEnv, hashInternalSessionToken, internalAttemptCookieName, internalCookieOptions, internalSessionCookieName, verifyInternalAccessCode } from "@/shared/auth/internal-access";

const schema = z.object({ code: z.string().min(8).max(128) }).strict();

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json());
    const env = getInternalAccessEnv();
    const now = new Date();
    const attemptState = decodeInternalAttempts((await cookies()).get(internalAttemptCookieName)?.value, env.INTERNAL_ACCESS_HMAC_SECRET, now) ?? { failedAttempts: 0, expiresAt: now.getTime() + env.INTERNAL_ACCESS_WINDOW_SECONDS * 1_000 };
    if (attemptState.failedAttempts >= env.INTERNAL_ACCESS_MAX_ATTEMPTS) return NextResponse.json({ error: { code: "INTERNAL_ACCESS_RATE_LIMITED", message: "Muitas tentativas. Aguarde antes de tentar novamente." } }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(Math.ceil((attemptState.expiresAt - now.getTime()) / 1000), 1)) } });
    const prisma = getPrisma();
    const organization = await prisma.organization.findUnique({ where: { slug: "jf-demo" } });
    if (!organization || organization.status !== "ACTIVE") throw new Error("InternalOrganizationUnavailable");
    if (!verifyInternalAccessCode(input.code, env.INTERNAL_ACCESS_CODE_HASH, env.INTERNAL_ACCESS_HMAC_SECRET)) {
      const failed = { ...attemptState, failedAttempts: attemptState.failedAttempts + 1 };
      await prisma.internalAuditEvent.create({ data: { organizationId: organization.id, eventType: "INTERNAL_SESSION_DENIED", entityType: "ORGANIZATION", entityRef: organization.externalRef, metadata: { reason: "INVALID_CODE" } } });
      const response = NextResponse.json({ error: { code: failed.failedAttempts >= env.INTERNAL_ACCESS_MAX_ATTEMPTS ? "INTERNAL_ACCESS_RATE_LIMITED" : "INTERNAL_ACCESS_DENIED", message: failed.failedAttempts >= env.INTERNAL_ACCESS_MAX_ATTEMPTS ? "Muitas tentativas. Aguarde antes de tentar novamente." : "Código interno inválido." } }, { status: failed.failedAttempts >= env.INTERNAL_ACCESS_MAX_ATTEMPTS ? 429 : 401, headers: { "Cache-Control": "no-store" } });
      response.cookies.set(internalAttemptCookieName, encodeInternalAttempts(failed, env.INTERNAL_ACCESS_HMAC_SECRET), internalCookieOptions(process.env.NODE_ENV === "production", Math.max(Math.ceil((failed.expiresAt - now.getTime()) / 1000), 1)));
      return response;
    }
    const token = createInternalSessionToken();
    const expiresAt = new Date(now.getTime() + env.INTERNAL_SESSION_MAX_AGE_SECONDS * 1_000);
    const session = await prisma.internalSession.create({ data: { organizationId: organization.id, tokenHash: hashInternalSessionToken(token), expiresAt } });
    await prisma.internalAuditEvent.create({ data: { organizationId: organization.id, internalSessionId: session.id, eventType: "INTERNAL_SESSION_STARTED", entityType: "ORGANIZATION", entityRef: organization.externalRef, metadata: { role: "SANDBOX_EDITOR" } } });
    const response = NextResponse.json({ redirectTo: "/internal" }, { headers: { "Cache-Control": "no-store" } });
    response.cookies.set(internalSessionCookieName, token, internalCookieOptions(process.env.VERCEL_ENV === "production" || process.env.NODE_ENV === "production", env.INTERNAL_SESSION_MAX_AGE_SECONDS));
    response.cookies.set(internalAttemptCookieName, "", { ...internalCookieOptions(process.env.NODE_ENV === "production", 1), expires: new Date(0) });
    return response;
  } catch (error) {
    console.error({ errorName: error instanceof Error ? error.name : "UnknownError", route: "internal-authenticate" });
    return NextResponse.json({ error: { code: "INTERNAL_UNAVAILABLE", message: "A área interna está temporariamente indisponível." } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE() {
  const jar = await cookies();
  const token = jar.get(internalSessionCookieName)?.value;
  if (token) await getPrisma().internalSession.updateMany({ where: { tokenHash: hashInternalSessionToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
  const response = NextResponse.json({ signedOut: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(internalSessionCookieName, "", { ...internalCookieOptions(process.env.NODE_ENV === "production", 1), expires: new Date(0) });
  return response;
}
