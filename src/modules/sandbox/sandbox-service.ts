import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { ApplicationError } from "@/shared/errors/application-error";
import { generateDemoIdentifier } from "@/shared/demo/demo-identifier";

import type { SandboxScenarioInput } from "./sandbox.schemas";

const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateText = (value: Date) => value.toISOString().slice(0, 10);
const opaqueRef = (kind: string) => `${kind}-${randomUUID()}`;
export function createSandboxReferences(scenarioName: string) {
  return {
    profile: opaqueRef("profile"), challenge: opaqueRef("challenge"), creditor: opaqueRef("creditor"),
    debtor: opaqueRef("debtor"), debt: opaqueRef("debt"), identifier: generateDemoIdentifier(scenarioName),
  };
}

export class SandboxService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(organizationId: string) {
    return this.prisma.sandboxIdentityProfile.findMany({
      where: { organizationId }, orderBy: { createdAt: "desc" },
      include: { challenge: { include: { options: { orderBy: { position: "asc" } } } }, debtors: { include: { creditor: true, debts: { include: { offers: true } } } } },
    });
  }

  async get(organizationId: string, profileRef: string) {
    const result = await this.prisma.sandboxIdentityProfile.findUnique({
      where: { organizationId_profileRef: { organizationId, profileRef } },
      include: { challenge: { include: { options: { orderBy: { position: "asc" } } } }, debtors: { include: { creditor: true, debts: { include: { offers: { orderBy: { createdAt: "asc" } } } } } } },
    });
    if (!result) throw new ApplicationError("SANDBOX_SCENARIO_NOT_FOUND", "Cenário demonstrativo não encontrado.", 404);
    return result;
  }

  async create(organizationId: string, sessionId: string, input: SandboxScenarioInput) {
    const refs = createSandboxReferences(input.scenarioName);
    return this.prisma.$transaction(async (tx) => {
      const creditor = await tx.sandboxCreditor.create({ data: { organizationId, creditorRef: refs.creditor, displayName: input.creditor.displayName, isDemo: true } });
      const profile = await tx.sandboxIdentityProfile.create({ data: { organizationId, profileRef: refs.profile, demoIdentifier: refs.identifier, maskedDisplayName: input.debtor.displayName, scenarioName: input.scenarioName, isDemo: true } });
      await tx.sandboxIdentityChallenge.create({ data: {
        organizationId, identityProfileId: profile.id, challengeRef: refs.challenge,
        prompt: input.challenge.prompt, maxAttempts: 3, isDemo: true,
        options: { create: input.challenge.options.map((option, position) => ({ optionRef: opaqueRef("option"), label: option.label, position, isCorrect: position === input.challenge.correctOptionIndex, isDemo: true })) },
      } });
      const debtor = await tx.sandboxDebtor.create({ data: { organizationId, creditorId: creditor.id, identityProfileId: profile.id, debtorRef: refs.debtor, displayName: input.debtor.displayName, isDemo: true } });
      const debt = await tx.sandboxDebt.create({ data: { organizationId, creditorId: creditor.id, debtorId: debtor.id, debtRef: refs.debt, description: input.debt.description, amountInCents: input.debt.amountInCents, dueDate: dateOnly(input.debt.dueDate), currency: "BRL", status: "OPEN", isDemo: true } });
      await tx.sandboxAuthorizedOffer.createMany({ data: input.offers.map((offer) => ({ organizationId, debtId: debt.id, offerRef: opaqueRef("offer"), ...offer, firstDueDate: dateOnly(offer.firstDueDate), expiresAt: new Date(offer.expiresAt), status: "AVAILABLE", isDemo: true })) });
      await tx.internalAuditEvent.create({ data: { organizationId, internalSessionId: sessionId, eventType: "SANDBOX_SCENARIO_CREATED", entityType: "SANDBOX_IDENTITY_PROFILE", entityRef: profile.profileRef, metadata: { isDemo: true, offerCount: input.offers.length } } });
      return { demoIdentifier: profile.demoIdentifier, scenarioName: profile.scenarioName, publicTestPath: "/demo/jf-demo" };
    });
  }

  async update(organizationId: string, sessionId: string, profileRef: string, input: SandboxScenarioInput) {
    const current = await this.get(organizationId, profileRef);
    if (current.debtors.length !== 1 || current.debtors[0].debts.length !== 1 || !current.challenge) {
      throw new ApplicationError("SANDBOX_SCENARIO_COMPLEX", "Este cenário não pode ser editado pelo assistente simplificado.", 409);
    }
    return this.prisma.$transaction(async (tx) => {
      const challenge = current.challenge!;
      const debtor = current.debtors[0];
      const debt = debtor.debts[0];
      await tx.sandboxCreditor.update({ where: { id: debtor.creditor.id }, data: { displayName: input.creditor.displayName, version: { increment: 1 } } });
      await tx.sandboxIdentityProfile.update({ where: { id: current.id }, data: { scenarioName: input.scenarioName, maskedDisplayName: input.debtor.displayName, version: { increment: 1 } } });
      await tx.sandboxIdentityChallenge.update({ where: { id: challenge.id }, data: { prompt: input.challenge.prompt, version: { increment: 1 }, options: { deleteMany: {}, create: input.challenge.options.map((option, position) => ({ optionRef: opaqueRef("option"), label: option.label, position, isCorrect: position === input.challenge.correctOptionIndex, isDemo: true })) } } });
      await tx.sandboxDebtor.update({ where: { id: debtor.id }, data: { displayName: input.debtor.displayName, version: { increment: 1 } } });
      await tx.sandboxDebt.update({ where: { id: debt.id }, data: { description: input.debt.description, amountInCents: input.debt.amountInCents, dueDate: dateOnly(input.debt.dueDate), version: { increment: 1 } } });

      const activeOffers = debt.offers.filter((offer) => offer.recordStatus === "ACTIVE");
      for (const [index, offerInput] of input.offers.entries()) {
        const existing = activeOffers[index];
        if (existing) {
          await tx.sandboxAuthorizedOffer.update({ where: { id: existing.id }, data: { ...offerInput, firstDueDate: dateOnly(offerInput.firstDueDate), expiresAt: new Date(offerInput.expiresAt), version: { increment: 1 } } });
        } else {
          await tx.sandboxAuthorizedOffer.create({ data: { organizationId, debtId: debt.id, offerRef: opaqueRef("offer"), ...offerInput, firstDueDate: dateOnly(offerInput.firstDueDate), expiresAt: new Date(offerInput.expiresAt), status: "AVAILABLE", isDemo: true } });
        }
      }
      const removedIds = activeOffers.slice(input.offers.length).map((offer) => offer.id);
      if (removedIds.length) await tx.sandboxAuthorizedOffer.updateMany({ where: { organizationId, debtId: debt.id, id: { in: removedIds } }, data: { recordStatus: "INACTIVE", version: { increment: 1 } } });
      await tx.internalAuditEvent.create({ data: { organizationId, internalSessionId: sessionId, eventType: "SANDBOX_SCENARIO_UPDATED", entityType: "SANDBOX_IDENTITY_PROFILE", entityRef: profileRef, metadata: { isDemo: true, versioned: ["challenge", "debt", "offers"] } } });
      return { demoIdentifier: current.demoIdentifier, scenarioName: input.scenarioName, publicTestPath: "/demo/jf-demo" };
    });
  }

  async setActive(organizationId: string, sessionId: string, profileRef: string, active: boolean) {
    const current = await this.get(organizationId, profileRef);
    const status = active ? "ACTIVE" : "INACTIVE";
    await this.prisma.$transaction(async (tx) => {
      await tx.sandboxIdentityProfile.update({ where: { id: current.id }, data: { status, version: { increment: 1 } } });
      await tx.internalAuditEvent.create({ data: { organizationId, internalSessionId: sessionId, eventType: active ? "SANDBOX_SCENARIO_ACTIVATED" : "SANDBOX_SCENARIO_DEACTIVATED", entityType: "SANDBOX_IDENTITY_PROFILE", entityRef: profileRef, metadata: { isDemo: true } } });
    });
  }

  present(value: Awaited<ReturnType<SandboxService["get"]>>, now = new Date()) {
    const debtor = value.debtors[0]; const debt = debtor?.debts[0];
    const options = value.challenge?.options ?? [];
    return {
      scenarioName: value.scenarioName, demoIdentifier: value.demoIdentifier, debtor: debtor && { displayName: debtor.displayName }, active: value.status === "ACTIVE",
      challenge: value.challenge && { prompt: value.challenge.prompt, correctOptionIndex: Math.max(options.findIndex((option) => option.isCorrect), 0), options: options.map(({ label }) => ({ label })) },
      creditor: debtor && { displayName: debtor.creditor.displayName },
      debt: debt && { description: debt.description, amountInCents: debt.amountInCents, dueDate: dateText(debt.dueDate) },
      offers: debt?.offers.filter((offer) => offer.recordStatus === "ACTIVE").map((offer) => ({ kind: offer.kind, totalAmountInCents: offer.totalAmountInCents, downPaymentAmountInCents: offer.downPaymentAmountInCents, installmentCount: offer.installmentCount, installmentAmountInCents: offer.installmentAmountInCents, firstDueDate: dateText(offer.firstDueDate), expiresAt: offer.expiresAt.toISOString(), effectiveStatus: offer.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : offer.status })) ?? [],
    };
  }
}
