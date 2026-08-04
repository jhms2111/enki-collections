import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireInternalSession, internalSessionCookieName } from "@/modules/sandbox/internal-session";
import { sandboxScenarioStatusSchema } from "@/modules/sandbox/sandbox.schemas";
import { SandboxService } from "@/modules/sandbox/sandbox-service";
import { getPrisma } from "@/shared/database/prisma";
import { toErrorResponse } from "@/shared/errors/error-response";
type Context = { params: Promise<{ profileRef: string }> };
export async function POST(request: Request, context: Context) { try { const session = await requireInternalSession((await cookies()).get(internalSessionCookieName)?.value); if (!session) return NextResponse.json({ error: { code: "INTERNAL_SESSION_REQUIRED", message: "Sessão interna obrigatória." } }, { status: 401 }); const { profileRef } = await context.params; const input = sandboxScenarioStatusSchema.parse(await request.json()); await new SandboxService(getPrisma()).setActive(session.organizationId, session.id, profileRef, input.active); return NextResponse.json({ profileRef, active: input.active }, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return toErrorResponse(error); } }
