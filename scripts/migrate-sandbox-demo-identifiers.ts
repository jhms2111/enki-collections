import "dotenv/config";

import { getPrisma } from "../src/shared/database/prisma";
import { generateDemoIdentifier, isDemoIdentifier } from "../src/shared/demo/demo-identifier";

const historicalFixtures = new Set(["DEMO-AURORA-001", "DEMO-BENTO-002"]);

async function main() {
  const prisma = getPrisma();
  try {
    const profiles = await prisma.sandboxIdentityProfile.findMany({ where: { isDemo: true }, select: { id: true, organizationId: true, profileRef: true, demoIdentifier: true, scenarioName: true, status: true } });
    const candidates = profiles.filter((profile) => !historicalFixtures.has(profile.demoIdentifier) && !isDemoIdentifier(profile.demoIdentifier));
    const occupied = new Set(profiles.map((profile) => `${profile.organizationId}:${profile.demoIdentifier}`));
    const changes = candidates.map((profile) => {
      let next: string;
      do { next = generateDemoIdentifier(profile.scenarioName); } while (occupied.has(`${profile.organizationId}:${next}`));
      occupied.add(`${profile.organizationId}:${next}`);
      return { ...profile, next };
    });

    await prisma.$transaction(async (tx) => {
      for (const change of changes) {
        await tx.sandboxIdentityProfile.update({ where: { id: change.id }, data: { demoIdentifier: change.next, version: { increment: 1 } } });
        await tx.internalAuditEvent.create({ data: { organizationId: change.organizationId, eventType: "SANDBOX_DEMO_IDENTIFIER_MIGRATED", entityType: "SANDBOX_IDENTITY_PROFILE", entityRef: change.profileRef, metadata: { isDemo: true, rule: "readable-v1" } } });
      }
    });
    process.stdout.write(JSON.stringify({ updated: changes.length, activeUpdated: changes.filter((change) => change.status === "ACTIVE").length, fixturesChanged: 0 }) + "\n");
  } finally { await prisma.$disconnect(); }
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.name : "MIGRATION_FAILED"}\n`); process.exitCode = 1; });
