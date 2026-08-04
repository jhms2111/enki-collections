import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireInternalSession, internalSessionCookieName } from "@/modules/sandbox/internal-session";
import { sandboxScenarioInputSchema } from "@/modules/sandbox/sandbox.schemas";
import { SandboxService } from "@/modules/sandbox/sandbox-service";
import { getPrisma } from "@/shared/database/prisma";
import { toErrorResponse } from "@/shared/errors/error-response";

async function authorized() { return requireInternalSession((await cookies()).get(internalSessionCookieName)?.value); }
export async function GET() { const session = await authorized(); if (!session) return NextResponse.json({ error: { code: "INTERNAL_SESSION_REQUIRED", message: "Sessão interna obrigatória." } }, { status: 401 }); const service = new SandboxService(getPrisma()); const rows = await service.list(session.organizationId); return NextResponse.json(rows.map((row) => ({ profileRef: row.profileRef, demoIdentifier: row.demoIdentifier, maskedDisplayName: row.maskedDisplayName, active: row.status === "ACTIVE", creditorCount: row.debtors.length, debtCount: row.debtors.reduce((total, debtor) => total + debtor.debts.length, 0), offerCount: row.debtors.reduce((total, debtor) => total + debtor.debts.reduce((sum, debt) => sum + debt.offers.length, 0), 0) })), { headers: { "Cache-Control": "no-store" } }); }
export async function POST(request: Request) { try { const session = await authorized(); if (!session) return NextResponse.json({ error: { code: "INTERNAL_SESSION_REQUIRED", message: "Sessão interna obrigatória." } }, { status: 401 }); const input = sandboxScenarioInputSchema.parse(await request.json()); const result = await new SandboxService(getPrisma()).create(session.organizationId, session.id, input); return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "no-store" } }); } catch (error) { return toErrorResponse(error); } }
