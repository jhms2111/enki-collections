import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireInternalSession, internalSessionCookieName } from "@/modules/sandbox/internal-session";
import { sandboxScenarioInputSchema } from "@/modules/sandbox/sandbox.schemas";
import { SandboxService } from "@/modules/sandbox/sandbox-service";
import { toSandboxErrorResponse } from "@/modules/sandbox/sandbox-error-response";
import { getPrisma } from "@/shared/database/prisma";

async function authorized() { return requireInternalSession((await cookies()).get(internalSessionCookieName)?.value); }
export async function GET() { const session = await authorized(); if (!session) return NextResponse.json({ error: { code: "INTERNAL_SESSION_REQUIRED", message: "Sessão interna obrigatória." } }, { status: 401, headers: { "Cache-Control": "private, no-store" } }); const service = new SandboxService(getPrisma()); const rows = await service.list(session.organizationId); return NextResponse.json(rows.map((row) => ({ profileRef: row.profileRef, demoIdentifier: row.demoIdentifier, scenarioName: row.scenarioName, debtorName: row.debtors[0]?.displayName ?? row.maskedDisplayName, active: row.status === "ACTIVE", creditorCount: row.debtors.length, debtCount: row.debtors.reduce((total, debtor) => total + debtor.debts.length, 0), offerCount: row.debtors.reduce((total, debtor) => total + debtor.debts.reduce((sum, debt) => sum + debt.offers.filter((offer) => offer.recordStatus === "ACTIVE").length, 0), 0) })), { headers: { "Cache-Control": "private, no-store" } }); }
export async function POST(request: Request) { try { const session = await authorized(); if (!session) return NextResponse.json({ error: { code: "INTERNAL_SESSION_REQUIRED", message: "Sessão interna obrigatória." } }, { status: 401, headers: { "Cache-Control": "private, no-store" } }); const input = sandboxScenarioInputSchema.parse(await request.json()); const result = await new SandboxService(getPrisma()).create(session.organizationId, session.id, input); return NextResponse.json(result, { status: 201, headers: { "Cache-Control": "private, no-store" } }); } catch (error) { return toSandboxErrorResponse(error); } }
