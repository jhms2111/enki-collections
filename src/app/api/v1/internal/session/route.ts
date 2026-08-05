import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireInternalSession, internalSessionCookieName } from "@/modules/sandbox/internal-session";

export async function GET() {
  const session = await requireInternalSession((await cookies()).get(internalSessionCookieName)?.value);
  if (!session) return NextResponse.json({ error: { code: "INTERNAL_SESSION_REQUIRED", message: "Sessão interna obrigatória." } }, { status: 401, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ organization: { slug: session.organization.slug, name: session.organization.name }, role: session.role, expiresAt: session.expiresAt.toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
}
