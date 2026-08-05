import { createHash } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import type { OrganizationContext } from "@/modules/organizations/organization-context";
import { assertOrganizationContext } from "@/modules/organizations/organization-context";
import { ApplicationError } from "@/shared/errors/application-error";
import { assertIdempotencyKey } from "@/shared/idempotency/idempotency";
import { isDemoIdentifier } from "@/shared/demo/demo-identifier";

import type { DebtProvider } from "../debt-provider";
import type { AuthorizedOffer, DebtorIdentification, DebtDetails, DebtSummary, DemoDebtorIdentifier, DemoPaymentInstrument, DemoPaymentInstrumentType, DisputeInput, DisputeResult, IdentityChallenge, IdentityVerification, OfferAcceptanceInput, OfferAcceptanceResult, PaymentPromiseInput, PaymentPromiseResult, PaymentReportInput, PaymentReportResult, PaymentStatus, VerifiedDebtorContext } from "../debt-provider.types";

type StoredIdempotency = { digest: string; result: unknown };
const opaque = (prefix: string, value: string) => `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);

export class SandboxDebtProvider implements DebtProvider {
  private readonly idempotency = new Map<string, StoredIdempotency>();
  constructor(private readonly prisma: PrismaClient, private readonly now: () => Date = () => new Date()) {}

  async identifyDebtor(organization: OrganizationContext, identifier: DemoDebtorIdentifier): Promise<DebtorIdentification | null> {
    this.assertOrganization(organization);
    if (identifier.type !== "DEMO_ID" || !isDemoIdentifier(identifier.value)) return null;
    const profile = await this.prisma.sandboxIdentityProfile.findUnique({
      where: { organizationId_demoIdentifier: { organizationId: organization.organizationId, demoIdentifier: identifier.value } },
      include: { challenge: true, debtors: { include: { creditor: true } } },
    });
    if (!profile || profile.status !== "ACTIVE" || !profile.isDemo || profile.challenge?.status !== "ACTIVE") return null;
    const accounts = profile.debtors.filter((debtor) => debtor.status === "ACTIVE" && debtor.isDemo && debtor.creditor.status === "ACTIVE" && debtor.creditor.isDemo).map((debtor) => ({ debtorRef: debtor.debtorRef, creditorRef: debtor.creditor.creditorRef }));
    if (!accounts.length) return null;
    return { identificationRef: this.identificationRef(organization.organizationId, profile.profileRef), maskedDisplayName: profile.maskedDisplayName, accounts };
  }

  async getIdentityChallenge(organization: OrganizationContext, identificationRef: string): Promise<IdentityChallenge> {
    const profile = await this.profileForIdentification(organization, identificationRef);
    if (!profile.challenge || profile.challenge.status !== "ACTIVE") throw this.notFound();
    return { challengeRef: profile.challenge.challengeRef, prompt: profile.challenge.prompt, maxAttempts: profile.challenge.maxAttempts, options: profile.challenge.options.map(({ optionRef, label }) => ({ optionRef, label })) };
  }

  async verifyIdentity(organization: OrganizationContext, identificationRef: string, challengeRef: string, optionRef: string): Promise<IdentityVerification> {
    const profile = await this.profileForIdentification(organization, identificationRef);
    const challenge = profile.challenge;
    if (!challenge || challenge.challengeRef !== challengeRef) return { verified: false, attemptsRemaining: 2, blocked: false };
    const correct = challenge.options.some((option) => option.optionRef === optionRef && option.isCorrect);
    if (!correct) return { verified: false, attemptsRemaining: 2, blocked: false };
    const authorizedAccounts = profile.debtors.filter((debtor) => debtor.status === "ACTIVE" && debtor.creditor.status === "ACTIVE").map((debtor) => ({ debtorRef: debtor.debtorRef, creditorRef: debtor.creditor.creditorRef }));
    return { verified: true, debtorContext: { verificationRef: this.verificationRef(organization.organizationId, profile.profileRef), authorizedAccounts } };
  }

  async listDebts(organization: OrganizationContext, debtor: VerifiedDebtorContext): Promise<readonly DebtSummary[]> {
    const profile = await this.assertVerified(organization, debtor);
    return profile.debtors.flatMap((account) => account.debts.filter((debt) => debt.recordStatus === "ACTIVE" && debt.isDemo).map((debt) => this.debtSummary(account.creditor.creditorRef, account.creditor.displayName, account.debtorRef, debt)));
  }

  async getDebt(organization: OrganizationContext, debtor: VerifiedDebtorContext, debtRef: string): Promise<DebtDetails> {
    const found = await this.findDebt(organization, debtor, debtRef);
    return { ...this.debtSummary(found.creditorRef, found.creditorName, found.debtorRef, found.debt), providerVersion: `sandbox-debt-v${found.debt.version}` };
  }

  async listAuthorizedOffers(organization: OrganizationContext, debtor: VerifiedDebtorContext, debtRef: string): Promise<readonly AuthorizedOffer[]> {
    const found = await this.findDebt(organization, debtor, debtRef);
    return found.debt.offers.filter((offer) => offer.recordStatus === "ACTIVE" && offer.status !== "DISABLED" && offer.isDemo).map((offer) => this.offer(found.debt, found.debtorRef, found.creditorRef, offer));
  }

  async getAuthorizedOffer(organization: OrganizationContext, debtor: VerifiedDebtorContext, offerRef: string): Promise<AuthorizedOffer> {
    const profile = await this.assertVerified(organization, debtor);
    for (const account of profile.debtors) for (const debt of account.debts) {
      const offer = debt.offers.find((candidate) => candidate.offerRef === offerRef && candidate.recordStatus === "ACTIVE");
      if (offer) return this.offer(debt, account.debtorRef, account.creditor.creditorRef, offer);
    }
    throw this.notFound();
  }

  async acceptOffer(organization: OrganizationContext, debtor: VerifiedDebtorContext, input: OfferAcceptanceInput): Promise<OfferAcceptanceResult> {
    assertIdempotencyKey(input.idempotencyKey);
    return this.idempotent(organization, "ACCEPT_OFFER", input.idempotencyKey, input, async () => {
      const offer = await this.getAuthorizedOffer(organization, debtor, input.offerRef);
      if (offer.status !== "AVAILABLE" || new Date(offer.expiresAt).getTime() <= this.now().getTime()) throw new ApplicationError("OFFER_EXPIRED", "A proposta não está mais disponível.", 409);
      if (offer.providerVersion !== input.expectedProviderVersion || !same(offer.terms, input.expectedTerms)) throw new ApplicationError("OFFER_CHANGED", "A proposta foi alterada e deve ser apresentada novamente.", 409);
      return { acceptanceRef: opaque("acceptance", `${organization.organizationId}:${input.idempotencyKey}`), offerRef: offer.offerRef, providerVersion: offer.providerVersion, acceptedAt: input.acceptedAt };
    });
  }

  async createPaymentInstrument(organization: OrganizationContext, debtor: VerifiedDebtorContext, input: Readonly<{ idempotencyKey: string; acceptanceRef: string; type: DemoPaymentInstrumentType }>): Promise<DemoPaymentInstrument> {
    assertIdempotencyKey(input.idempotencyKey); await this.assertVerified(organization, debtor);
    return this.idempotent(organization, "CREATE_PAYMENT_INSTRUMENT", input.idempotencyKey, input, async () => {
      const acceptance = await this.prisma.offerAcceptance.findFirst({ where: { organizationId: organization.organizationId, providerAcceptanceRef: input.acceptanceRef } });
      if (!acceptance) throw this.notFound();
      await this.findDebt(organization, debtor, acceptance.debtRef);
      const instrumentRef = opaque("instrument", `${organization.organizationId}:${input.idempotencyKey}`);
      const values: Record<DemoPaymentInstrumentType, string> = { DEMO_LINK: `REFERÊNCIA-DEMO-${instrumentRef}`, DEMO_BOLETO: "LINHA-DIGITÁVEL-DEMO-INVÁLIDA", DEMO_PIX: "PIX-DEMO-INVÁLIDO-NÃO-PAGÁVEL" };
      return { instrumentRef, acceptanceRef: input.acceptanceRef, type: input.type, displayValue: values[input.type], expiresAt: "2099-12-31T23:59:59.000Z", isDemo: true, warning: "DEMONSTRAÇÃO — SEM VALOR FINANCEIRO" };
    });
  }

  async getPaymentStatus(organization: OrganizationContext, debtor: VerifiedDebtorContext, debtRef: string): Promise<PaymentStatus> { const found = await this.findDebt(organization, debtor, debtRef); return { debtRef, status: found.debt.status === "PAID" ? "PAID" : "OPEN", updatedAt: found.debt.updatedAt.toISOString() }; }
  async registerPaymentPromise(organization: OrganizationContext, debtor: VerifiedDebtorContext, input: PaymentPromiseInput): Promise<PaymentPromiseResult> { assertIdempotencyKey(input.idempotencyKey); await this.findDebt(organization, debtor, input.debtRef); return this.idempotent(organization, "REGISTER_PAYMENT_PROMISE", input.idempotencyKey, input, async () => ({ providerReference: opaque("promise", `${organization.organizationId}:${input.idempotencyKey}`), debtRef: input.debtRef, promisedDate: input.promisedDate, status: "RECORDED" })); }
  async reportPayment(organization: OrganizationContext, debtor: VerifiedDebtorContext, input: PaymentReportInput): Promise<PaymentReportResult> { assertIdempotencyKey(input.idempotencyKey); await this.findDebt(organization, debtor, input.debtRef); return this.idempotent(organization, "REPORT_PAYMENT", input.idempotencyKey, input, async () => ({ providerReference: opaque("payment_report", `${organization.organizationId}:${input.idempotencyKey}`), debtRef: input.debtRef, status: "PENDING_REVIEW" })); }
  async openDispute(organization: OrganizationContext, debtor: VerifiedDebtorContext, input: DisputeInput): Promise<DisputeResult> { assertIdempotencyKey(input.idempotencyKey); await this.findDebt(organization, debtor, input.debtRef); return this.idempotent(organization, "OPEN_DISPUTE", input.idempotencyKey, input, async () => ({ providerReference: opaque("dispute", `${organization.organizationId}:${input.idempotencyKey}`), debtRef: input.debtRef, status: "PENDING_REVIEW" })); }

  private assertOrganization(context: OrganizationContext) { assertOrganizationContext(context); }
  private identificationRef(organizationId: string, profileRef: string) { return opaque("identification", `${organizationId}:${profileRef}`); }
  private verificationRef(organizationId: string, profileRef: string) { return opaque("verification", `${organizationId}:${profileRef}`); }
  private async profiles(organization: OrganizationContext) { this.assertOrganization(organization); return this.prisma.sandboxIdentityProfile.findMany({ where: { organizationId: organization.organizationId, status: "ACTIVE", isDemo: true }, include: { challenge: { include: { options: { orderBy: { position: "asc" } } } }, debtors: { where: { status: "ACTIVE", isDemo: true }, include: { creditor: true, debts: { where: { recordStatus: "ACTIVE", isDemo: true }, include: { offers: true } } } } } }); }
  private async profileForIdentification(organization: OrganizationContext, identificationRef: string) { const profile = (await this.profiles(organization)).find((candidate) => this.identificationRef(organization.organizationId, candidate.profileRef) === identificationRef); if (!profile) throw this.notFound(); return profile; }
  private async assertVerified(organization: OrganizationContext, debtor: VerifiedDebtorContext) { const profile = (await this.profiles(organization)).find((candidate) => this.verificationRef(organization.organizationId, candidate.profileRef) === debtor.verificationRef); if (!profile) throw new ApplicationError("INVALID_DEBTOR_CONTEXT", "O contexto do devedor não é válido para esta organização.", 403); const expected = profile.debtors.map((account) => ({ debtorRef: account.debtorRef, creditorRef: account.creditor.creditorRef })); if (!same(expected, debtor.authorizedAccounts)) throw new ApplicationError("INVALID_DEBTOR_CONTEXT", "O contexto do devedor não é válido para esta organização.", 403); return profile; }
  private async findDebt(organization: OrganizationContext, debtor: VerifiedDebtorContext, debtRef: string) { const profile = await this.assertVerified(organization, debtor); for (const account of profile.debtors) { const debt = account.debts.find((candidate) => candidate.debtRef === debtRef); if (debt) return { debt, debtorRef: account.debtorRef, creditorRef: account.creditor.creditorRef, creditorName: account.creditor.displayName }; } throw this.notFound(); }
  private debtSummary(creditorRef: string, creditorName: string, debtorRef: string, debt: { debtRef: string; description: string; amountInCents: number; dueDate: Date; status: string }) { return { debtRef: debt.debtRef, debtorRef, creditor: { creditorRef, displayName: creditorName }, description: debt.description, amount: { amountInCents: debt.amountInCents, currency: "BRL" as const }, dueDate: dateOnly(debt.dueDate), status: debt.status as DebtSummary["status"] }; }
  private offer(debt: { debtRef: string }, debtorRef: string, creditorRef: string, offer: { offerRef: string; kind: string; totalAmountInCents: number; downPaymentAmountInCents: number; installmentCount: number; installmentAmountInCents: number; firstDueDate: Date; expiresAt: Date; status: string; version: number }) { const expired = offer.expiresAt.getTime() <= this.now().getTime(); return { offerRef: offer.offerRef, debtRef: debt.debtRef, debtorRef, creditorRef, providerVersion: `sandbox-offer-v${offer.version}`, terms: { kind: offer.kind as "CASH" | "INSTALLMENT", total: { amountInCents: offer.totalAmountInCents, currency: "BRL" }, downPayment: { amountInCents: offer.downPaymentAmountInCents, currency: "BRL" }, installmentCount: offer.installmentCount, installmentAmount: { amountInCents: offer.installmentAmountInCents, currency: "BRL" }, firstDueDate: dateOnly(offer.firstDueDate) }, expiresAt: offer.expiresAt.toISOString(), status: expired ? "EXPIRED" : offer.status as AuthorizedOffer["status"] } as AuthorizedOffer; }
  private async idempotent<Result>(organization: OrganizationContext, operation: string, key: string, payload: unknown, execute: () => Promise<Result>): Promise<Result> { const storageKey = `${organization.organizationId}:${operation}:${key}`; const payloadHash = digest(payload); const existing = this.idempotency.get(storageKey); if (existing) { if (existing.digest !== payloadHash) throw new ApplicationError("IDEMPOTENCY_CONFLICT", "A chave de idempotência já foi usada com outro conteúdo.", 409); return existing.result as Result; } const result = await execute(); this.idempotency.set(storageKey, { digest: payloadHash, result }); return result; }
  private notFound() { return new ApplicationError("PROVIDER_RESOURCE_NOT_FOUND", "Recurso demonstrativo não encontrado.", 404); }
}
