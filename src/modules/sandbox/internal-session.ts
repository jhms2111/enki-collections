import type { PrismaClient } from "@/generated/prisma/client";
import { getPrisma } from "@/shared/database/prisma";
import { hashInternalSessionToken, internalSessionCookieName } from "@/shared/auth/internal-access";

export async function requireInternalSession(token: string | undefined, prisma: PrismaClient = getPrisma()) {
  if (!token) return null;
  const now = new Date();
  const session = await prisma.internalSession.findFirst({
    where: { tokenHash: hashInternalSessionToken(token), revokedAt: null, expiresAt: { gt: now }, organization: { slug: "jf-demo", status: "ACTIVE" } },
    include: { organization: true },
  });
  if (!session) return null;
  await prisma.internalSession.update({ where: { id: session.id }, data: { lastActivityAt: now } });
  return session;
}

export { internalSessionCookieName };
