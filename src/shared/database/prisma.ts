import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import { getRuntimeEnv } from "@/shared/config/env";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const env = getRuntimeEnv();
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
  });

  return new PrismaClient({ adapter });
}

export function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma) {
    return globalForPrisma.prisma;
  }

  const client = createPrismaClient();
  if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = client;
  }
  return client;
}
