import type { PrismaClient } from "@/generated/prisma/client";
import { ApplicationError } from "@/shared/errors/application-error";

import type { SandboxScenarioInput } from "./sandbox.schemas";

const dateOnly = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateText = (value: Date) => value.toISOString().slice(0, 10);
const providerVersion = (kind: "challenge" | "debt" | "offer", version: number) => `sandbox-${kind}-v${version}`;

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
    return this.prisma.$transaction(async (tx) => {
      const creditor = await tx.sandboxCreditor.create({ data: { organizationId, ...input.creditor, isDemo: true } });
      const profile = await tx.sandboxIdentityProfile.create({ data: { organizationId, ...input.profile, isDemo: true } });
      const challenge = await tx.sandboxIdentityChallenge.create({ data: {
        organizationId, identityProfileId: profile.id, challengeRef: input.challenge.challengeRef,
        prompt: input.challenge.prompt, maxAttempts: 3, isDemo: true,
        options: { create: input.challenge.options.map((option, position) => ({ organizationId, ...option, position, isCorrect: option.optionRef === input.challenge.correctOptionRef, isDemo: true })) },
      } });
      const debtor = await tx.sandboxDebtor.create({ data: { organizationId, creditorId: creditor.id, identityProfileId: profile.id, ...input.debtor, isDemo: true } });
      const debt = await tx.sandboxDebt.create({ data: { organizationId, creditorId: creditor.id, debtorId: debtor.id, ...input.debt, dueDate: dateOnly(input.debt.dueDate), currency: "BRL", isDemo: true } });
      await tx.sandboxAuthorizedOffer.createMany({ data: input.offers.map((offer) => ({ organizationId, debtId: debt.id, ...offer, firstDueDate: dateOnly(offer.firstDueDate), expiresAt: new Date(offer.expiresAt), isDemo: true })) });
      await tx.internalAuditEvent.create({ data: { organizationId, internalSessionId: sessionId, eventType: "SANDBOX_SCENARIO_CREATED", entityType: "SANDBOX_IDENTITY_PROFILE", entityRef: profile.profileRef, metadata: { isDemo: true, offerCount: input.offers.length } } });
      return { profileRef: profile.profileRef, challengeVersion: providerVersion("challenge", challenge.version), debtVersion: providerVersion("debt", debt.version) };
    });
  }

  async update(organizationId: string, sessionId: string, profileRef: string, input: SandboxScenarioInput) {
    const current = await this.get(organizationId, profileRef);
    if (current.debtors.length !== 1 || current.debtors[0].debts.length !== 1 || !current.challenge) {
      throw new ApplicationError("SANDBOX_SCENARIO_COMPLEX", "Este cenário não pode ser editado pelo assistente simplificado.", 409);
    }
    const currentChallenge = current.challenge;
    const currentDebtor = current.debtors[0];
    const currentDebt = currentDebtor.debts[0];
    if (
      input.challenge.challengeRef !== currentChallenge.challengeRef ||
      input.creditor.creditorRef !== currentDebtor.creditor.creditorRef ||
      input.debtor.debtorRef !== currentDebtor.debtorRef ||
      input.debt.debtRef !== currentDebt.debtRef
    ) {
      throw new ApplicationError("IMMUTABLE_REFERENCE", "Referências estruturais do cenário não podem ser alteradas.", 409);
    }
    return this.prisma.$transaction(async (tx) => {
      const debtor = current.debtors[0];
      const debt = debtor.debts[0];
      await tx.sandboxCreditor.update({ where: { id: debtor.creditor.id }, data: { displayName: input.creditor.displayName, version: { increment: 1 } } });
      await tx.sandboxIdentityProfile.update({ where: { id: current.id }, data: { demoIdentifier: input.profile.demoIdentifier, maskedDisplayName: input.profile.maskedDisplayName, version: { increment: 1 } } });
      await tx.sandboxIdentityChallenge.update({ where: { id: currentChallenge.id }, data: { prompt: input.challenge.prompt, version: { increment: 1 }, options: { deleteMany: {}, create: input.challenge.options.map((option, position) => ({ organizationId, ...option, position, isCorrect: option.optionRef === input.challenge.correctOptionRef, isDemo: true })) } } });
      await tx.sandboxDebtor.update({ where: { id: debtor.id }, data: { version: { increment: 1 } } });
      await tx.sandboxDebt.update({ where: { id: debt.id }, data: { description: input.debt.description, amountInCents: input.debt.amountInCents, dueDate: dateOnly(input.debt.dueDate), status: input.debt.status, version: { increment: 1 } } });
      const currentOfferRefs = new Set(debt.offers.map((offer) => offer.offerRef));
      for (const offerInput of input.offers) {
        if (currentOfferRefs.has(offerInput.offerRef)) {
          await tx.sandboxAuthorizedOffer.update({ where: { organizationId_offerRef: { organizationId, offerRef: offerInput.offerRef } }, data: { ...offerInput, firstDueDate: dateOnly(offerInput.firstDueDate), expiresAt: new Date(offerInput.expiresAt), version: { increment: 1 } } });
        } else {
          await tx.sandboxAuthorizedOffer.create({ data: { organizationId, debtId: debt.id, ...offerInput, firstDueDate: dateOnly(offerInput.firstDueDate), expiresAt: new Date(offerInput.expiresAt), isDemo: true } });
        }
      }
      const retained = input.offers.map((offer) => offer.offerRef);
      await tx.sandboxAuthorizedOffer.updateMany({ where: { organizationId, debtId: debt.id, offerRef: { notIn: retained } }, data: { recordStatus: "INACTIVE", version: { increment: 1 } } });
      await tx.internalAuditEvent.create({ data: { organizationId, internalSessionId: sessionId, eventType: "SANDBOX_SCENARIO_UPDATED", entityType: "SANDBOX_IDENTITY_PROFILE", entityRef: profileRef, metadata: { isDemo: true, versioned: ["challenge", "debt", "offers"] } } });
      return { profileRef };
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
    return { profileRef: value.profileRef, demoIdentifier: value.demoIdentifier, maskedDisplayName: value.maskedDisplayName, active: value.status === "ACTIVE", challenge: value.challenge && { challengeRef: value.challenge.challengeRef, prompt: value.challenge.prompt, correctOptionRef: value.challenge.options.find((option) => option.isCorrect)?.optionRef, version: providerVersion("challenge", value.challenge.version), options: value.challenge.options.map(({ optionRef, label }) => ({ optionRef, label })) }, creditor: debtor && { creditorRef: debtor.creditor.creditorRef, displayName: debtor.creditor.displayName }, debtor: debtor && { debtorRef: debtor.debtorRef }, debt: debt && { debtRef: debt.debtRef, description: debt.description, amountInCents: debt.amountInCents, dueDate: dateText(debt.dueDate), status: debt.status, providerVersion: providerVersion("debt", debt.version) }, offers: debt?.offers.map((offer) => ({ offerRef: offer.offerRef, kind: offer.kind, totalAmountInCents: offer.totalAmountInCents, downPaymentAmountInCents: offer.downPaymentAmountInCents, installmentCount: offer.installmentCount, installmentAmountInCents: offer.installmentAmountInCents, firstDueDate: dateText(offer.firstDueDate), expiresAt: offer.expiresAt.toISOString(), status: offer.expiresAt.getTime() <= now.getTime() ? "EXPIRED" : offer.status, active: offer.recordStatus === "ACTIVE", providerVersion: providerVersion("offer", offer.version) })) ?? [] };
  }
}
