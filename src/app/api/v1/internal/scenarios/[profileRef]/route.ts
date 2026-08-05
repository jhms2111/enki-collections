import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireInternalSession, internalSessionCookieName } from "@/modules/sandbox/internal-session";
import { sandboxScenarioInputSchema } from "@/modules/sandbox/sandbox.schemas";
import { SandboxService } from "@/modules/sandbox/sandbox-service";
import { toSandboxErrorResponse } from "@/modules/sandbox/sandbox-error-response";
import { getPrisma } from "@/shared/database/prisma";

type Context = { params: Promise<{ profileRef: string }> };
async function authorized() { return requireInternalSession((await cookies()).get(internalSessionCookieName)?.value); }
export async function GET(_request: Request, context: Context) { try { const session = await authorized(); if (!session) return NextResponse.json({ error: { code: "INTERNAL_SESSION_REQUIRED", message: "Sessão interna obrigatória." } }, { status: 401, headers: { "Cache-Control": "private, no-store" } }); const { profileRef } = await context.params; const service = new SandboxService(getPrisma()); return NextResponse.json(service.present(await service.get(session.organizationId, profileRef)), { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return toSandboxErrorResponse(error); } }
export async function PUT(request: Request, context: Context) { try { const session = await authorized(); if (!session) return NextResponse.json({ error: { code: "INTERNAL_SESSION_REQUIRED", message: "Sessão interna obrigatória." } }, { status: 401, headers: { "Cache-Control": "private, no-store" } }); const { profileRef } = await context.params; const input = sandboxScenarioInputSchema.parse(await request.json()); const result = await new SandboxService(getPrisma()).update(session.organizationId, session.id, profileRef, input); return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return toSandboxErrorResponse(error); } }
