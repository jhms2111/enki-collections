import "dotenv/config";

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "../src/generated/prisma/client";
import { mockOrganizations } from "../src/modules/debt-provider/mock/mock-debt-provider.fixtures";

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

  await prisma.organization.upsert({
    where: { slug: "atlas-demo" },
    update: {
      name: "Atlas Demo — Organização Fictícia",
      status: "ACTIVE",
      timeZone: "America/Sao_Paulo",
    },
    create: {
      id: "org-atlas-demo",
      slug: "atlas-demo",
      externalRef: "ext_org_atlas_demo_91f7c0",
      name: "Atlas Demo — Organização Fictícia",
      status: "ACTIVE",
      timeZone: "America/Sao_Paulo",
    },
  });

  for (const organization of mockOrganizations) {
    const seenProfiles = new Set<string>();
    for (const creditorFixture of organization.creditors) {
      const creditor = await prisma.sandboxCreditor.upsert({
        where: {
          organizationId_creditorRef: {
            organizationId: organization.organizationId,
            creditorRef: creditorFixture.creditorRef,
          },
        },
        update: { displayName: creditorFixture.displayName },
        create: {
          organizationId: organization.organizationId,
          creditorRef: creditorFixture.creditorRef,
          displayName: creditorFixture.displayName,
          isDemo: true,
        },
      });

      for (const debtorFixture of creditorFixture.debtors) {
        const profileRef = `profile-${debtorFixture.demoIdentifier.toLowerCase()}`;
        const profile = await prisma.sandboxIdentityProfile.upsert({
          where: {
            organizationId_demoIdentifier: {
              organizationId: organization.organizationId,
              demoIdentifier: debtorFixture.demoIdentifier,
            },
          },
          update: { maskedDisplayName: debtorFixture.maskedDisplayName },
          create: {
            organizationId: organization.organizationId,
            profileRef,
            demoIdentifier: debtorFixture.demoIdentifier,
            maskedDisplayName: debtorFixture.maskedDisplayName,
            isDemo: true,
          },
        });

        if (!seenProfiles.has(profile.id)) {
          const challenge = await prisma.sandboxIdentityChallenge.upsert({
            where: { identityProfileId: profile.id },
            update: {
              prompt: debtorFixture.challenge.prompt,
              maxAttempts: debtorFixture.challenge.maxAttempts,
            },
            create: {
              organizationId: organization.organizationId,
              identityProfileId: profile.id,
              challengeRef: debtorFixture.challenge.challengeRef,
              prompt: debtorFixture.challenge.prompt,
              maxAttempts: debtorFixture.challenge.maxAttempts,
              isDemo: true,
            },
          });
          for (const [position, option] of debtorFixture.challenge.options.entries()) {
            await prisma.sandboxIdentityChallengeOption.upsert({
              where: {
                organizationId_challengeId_optionRef: {
                  organizationId: organization.organizationId,
                  challengeId: challenge.id,
                  optionRef: option.optionRef,
                },
              },
              update: {
                label: option.label,
                position,
                isCorrect:
                  option.optionRef === debtorFixture.challenge.correctOptionRef,
              },
              create: {
                organizationId: organization.organizationId,
                challengeId: challenge.id,
                optionRef: option.optionRef,
                label: option.label,
                position,
                isCorrect:
                  option.optionRef === debtorFixture.challenge.correctOptionRef,
                isDemo: true,
              },
            });
          }
          seenProfiles.add(profile.id);
        }

        const debtor = await prisma.sandboxDebtor.upsert({
          where: {
            organizationId_debtorRef: {
              organizationId: organization.organizationId,
              debtorRef: debtorFixture.debtorRef,
            },
          },
          update: { creditorId: creditor.id, identityProfileId: profile.id },
          create: {
            organizationId: organization.organizationId,
            creditorId: creditor.id,
            identityProfileId: profile.id,
            debtorRef: debtorFixture.debtorRef,
            isDemo: true,
          },
        });

        for (const debtFixture of debtorFixture.debts) {
          const details = debtFixture.details;
          const debt = await prisma.sandboxDebt.upsert({
            where: {
              organizationId_debtRef: {
                organizationId: organization.organizationId,
                debtRef: details.debtRef,
              },
            },
            update: {
              description: details.description,
              amountInCents: details.amount.amountInCents,
              dueDate: new Date(`${details.dueDate}T00:00:00.000Z`),
              status: details.status,
            },
            create: {
              organizationId: organization.organizationId,
              creditorId: creditor.id,
              debtorId: debtor.id,
              debtRef: details.debtRef,
              description: details.description,
              amountInCents: details.amount.amountInCents,
              dueDate: new Date(`${details.dueDate}T00:00:00.000Z`),
              status: details.status,
              version: Number(details.providerVersion.match(/(\d+)$/)?.[1] ?? 1),
              isDemo: true,
            },
          });

          for (const offer of debtFixture.offers) {
            await prisma.sandboxAuthorizedOffer.upsert({
              where: {
                organizationId_offerRef: {
                  organizationId: organization.organizationId,
                  offerRef: offer.offerRef,
                },
              },
              update: {
                kind: offer.terms.kind,
                totalAmountInCents: offer.terms.total.amountInCents,
                downPaymentAmountInCents: offer.terms.downPayment.amountInCents,
                installmentCount: offer.terms.installmentCount,
                installmentAmountInCents: offer.terms.installmentAmount.amountInCents,
                firstDueDate: new Date(`${offer.terms.firstDueDate}T00:00:00.000Z`),
                expiresAt: new Date(offer.expiresAt),
                status: offer.status,
              },
              create: {
                organizationId: organization.organizationId,
                debtId: debt.id,
                offerRef: offer.offerRef,
                kind: offer.terms.kind,
                totalAmountInCents: offer.terms.total.amountInCents,
                downPaymentAmountInCents: offer.terms.downPayment.amountInCents,
                installmentCount: offer.terms.installmentCount,
                installmentAmountInCents: offer.terms.installmentAmount.amountInCents,
                firstDueDate: new Date(`${offer.terms.firstDueDate}T00:00:00.000Z`),
                expiresAt: new Date(offer.expiresAt),
                status: offer.status,
                version: Number(offer.providerVersion.match(/(\d+)$/)?.[1] ?? 1),
                isDemo: true,
              },
            });
          }
        }
      }
    }
  }
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
