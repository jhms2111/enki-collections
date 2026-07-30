import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL é obrigatória para executar o seed.");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  await prisma.organization.upsert({
    where: { slug: "jf-demo" },
    update: {
      externalRef: "ext_org_7f4c2a91d8e64b5ca0f3",
      name: "JF Demo — Organização Fictícia",
      status: "ACTIVE",
      timeZone: "America/Sao_Paulo",
    },
    create: {
      id: "org-jf-demo",
      slug: "jf-demo",
      externalRef: "ext_org_7f4c2a91d8e64b5ca0f3",
      name: "JF Demo — Organização Fictícia",
      status: "ACTIVE",
      timeZone: "America/Sao_Paulo",
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error({
      message: "Não foi possível concluir o seed demonstrativo.",
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    await prisma.$disconnect();
    process.exit(1);
  });
