import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireInternalSession, internalSessionCookieName } from "@/modules/sandbox/internal-session";
import { sandboxScenarioInputSchema } from "@/modules/sandbox/sandbox.schemas";
import { SandboxService } from "@/modules/sandbox/sandbox-service";
import { getPrisma } from "@/shared/database/prisma";
import { toErrorResponse } from "@/shared/errors/error-response";

type Context = { params: Promise<{ profileRef: string }> };
async function authorized() { return requireInternalSession((await cookies()).get(internalSessionCookieName)?.value); }
export async function GET(_request: Request, context: Context) { try { const session = await authorized(); if (!session) return NextResponse.json({ error: { code: "INTERNAL_SESSION_REQUIRED", message: "Sessão interna obrigatória." } }, { status: 401 }); const { profileRef } = await context.params; const service = new SandboxService(getPrisma()); return NextResponse.json(service.present(await service.get(session.organizationId, profileRef)), { headers: { "Cache-Control": "no-store" } }); } catch (error) { return toErrorResponse(error); } }
export async function PUT(request: Request, context: Context) { try { const session = await authorized(); if (!session) return NextResponse.json({ error: { code: "INTERNAL_SESSION_REQUIRED", message: "Sessão interna obrigatória." } }, { status: 401 }); const { profileRef } = await context.params; const input = sandboxScenarioInputSchema.parse(await request.json()); if (input.profile.profileRef !== profileRef) return NextResponse.json({ error: { code: "IMMUTABLE_REFERENCE", message: "A referência do perfil não pode ser alterada." } }, { status: 409 }); const result = await new SandboxService(getPrisma()).update(session.organizationId, session.id, profileRef, input); return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } }); } catch (error) { return toErrorResponse(error); } }
