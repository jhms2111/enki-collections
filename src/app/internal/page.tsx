import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireInternalSession, internalSessionCookieName } from "@/modules/sandbox/internal-session";
import { ScenarioManager } from "@/modules/sandbox/scenario-manager";
import { SandboxService } from "@/modules/sandbox/sandbox-service";
import { getPrisma } from "@/shared/database/prisma";

export const dynamic = "force-dynamic";
export default async function InternalPage() { const session = await requireInternalSession((await cookies()).get(internalSessionCookieName)?.value); if (!session) redirect("/internal-access"); const rows = await new SandboxService(getPrisma()).list(session.organizationId); const initial = rows.map((row) => ({ profileRef: row.profileRef, demoIdentifier: row.demoIdentifier, maskedDisplayName: row.maskedDisplayName, active: row.status === "ACTIVE", creditorCount: row.debtors.length, debtCount: row.debtors.reduce((total, debtor) => total + debtor.debts.length, 0), offerCount: row.debtors.reduce((total, debtor) => total + debtor.debts.reduce((sum, debt) => sum + debt.offers.length, 0), 0) })); return <ScenarioManager initial={initial}/>; }
