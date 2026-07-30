import { createHash } from "node:crypto";

import type { OrganizationContext } from "@/modules/organizations/organization-context";
import { assertOrganizationContext } from "@/modules/organizations/organization-context";
import { ApplicationError } from "@/shared/errors/application-error";
import { assertIdempotencyKey } from "@/shared/idempotency/idempotency";

import type { DebtProvider } from "../debt-provider";
import type {
  AuthorizedOffer,
  DebtorIdentification,
  DebtDetails,
  DebtSummary,
  DemoDebtorIdentifier,
  DemoPaymentInstrument,
  DemoPaymentInstrumentType,
  DisputeInput,
  DisputeResult,
  IdentityChallenge,
  IdentityVerification,
  OfferAcceptanceInput,
  OfferAcceptanceResult,
  PaymentPromiseInput,
  PaymentPromiseResult,
  PaymentReportInput,
  PaymentReportResult,
  PaymentStatus,
  VerifiedDebtorContext,
} from "../debt-provider.types";
import {
  mockOrganizations,
  type MockDebtorFixture,
  type MockOrganizationFixture,
} from "./mock-debt-provider.fixtures";

type IdentificationState = Readonly<{
  organizationId: string;
  identificationRef: string;
  debtors: readonly MockDebtorFixture[];
  attempts: number;
  blocked: boolean;
}>;

type VerificationState = Readonly<{
  organizationId: string;
  debtorContext: VerifiedDebtorContext;
}>;

type AcceptanceState = Readonly<{
  organizationId: string;
  debtorRefs: readonly string[];
  result: OfferAcceptanceResult;
}>;

type IdempotencyRecord = Readonly<{
  payloadDigest: string;
  result: unknown;
}>;

function opaqueRef(prefix: string, value: string): string {
  const digest = createHash("sha256").update(value).digest("hex").slice(0, 20);
  return `${prefix}_${digest}`;
}

function payloadDigest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class MockDebtProvider implements DebtProvider {
  private readonly identifications = new Map<string, IdentificationState>();
  private readonly verifications = new Map<string, VerificationState>();
  private readonly acceptances = new Map<string, AcceptanceState>();
  private readonly idempotency = new Map<string, IdempotencyRecord>();

  constructor(
    private readonly organizations: readonly MockOrganizationFixture[] =
      mockOrganizations,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async identifyDebtor(
    organization: OrganizationContext,
    identifier: DemoDebtorIdentifier,
  ): Promise<DebtorIdentification | null> {
    const fixture = this.getOrganization(organization);

    if (
      identifier.type !== "DEMO_ID" ||
      !/^DEMO-[A-Z]+-\d{3}$/.test(identifier.value)
    ) {
      return null;
    }

    const matches = fixture.creditors.flatMap((creditor) =>
      creditor.debtors.filter(
        (debtor) => debtor.demoIdentifier === identifier.value,
      ),
    );

    if (matches.length === 0) {
      return null;
    }

    const identificationRef = opaqueRef(
      "identification",
      `${organization.organizationId}:${identifier.value}`,
    );
    this.identifications.set(
      this.scopedKey(organization.organizationId, identificationRef),
      {
        organizationId: organization.organizationId,
        identificationRef,
        debtors: matches,
        attempts: 0,
        blocked: false,
      },
    );

    return {
      identificationRef,
      maskedDisplayName: matches[0].maskedDisplayName,
      accounts: matches.map((debtor) => ({
        debtorRef: debtor.debtorRef,
        creditorRef: this.findCreditorRef(fixture, debtor),
      })),
    };
  }

  async getIdentityChallenge(
    organization: OrganizationContext,
    identificationRef: string,
  ): Promise<IdentityChallenge> {
    this.getOrganization(organization);
    const identification = this.getIdentification(
      organization,
      identificationRef,
    );
    const challenge = identification.debtors[0].challenge;

    return {
      challengeRef: challenge.challengeRef,
      prompt: challenge.prompt,
      options: challenge.options,
      maxAttempts: challenge.maxAttempts,
    };
  }

  async verifyIdentity(
    organization: OrganizationContext,
    identificationRef: string,
    challengeRef: string,
    optionRef: string,
  ): Promise<IdentityVerification> {
    const fixture = this.getOrganization(organization);
    const identification = this.getIdentification(
      organization,
      identificationRef,
    );
    const challenge = identification.debtors[0].challenge;

    if (identification.blocked) {
      return { verified: false, attemptsRemaining: 0, blocked: true };
    }

    const isCorrect =
      challenge.challengeRef === challengeRef &&
      challenge.correctOptionRef === optionRef;

    if (!isCorrect) {
      const attempts = identification.attempts + 1;
      const blocked = attempts >= challenge.maxAttempts;
      this.identifications.set(
        this.scopedKey(organization.organizationId, identificationRef),
        { ...identification, attempts, blocked },
      );

      return {
        verified: false,
        attemptsRemaining: Math.max(challenge.maxAttempts - attempts, 0),
        blocked,
      };
    }

    const verificationRef = opaqueRef(
      "verification",
      `${organization.organizationId}:${identificationRef}`,
    );
    const debtorContext: VerifiedDebtorContext = {
      verificationRef,
      authorizedAccounts: identification.debtors.map((debtor) => ({
        debtorRef: debtor.debtorRef,
        creditorRef: this.findCreditorRef(fixture, debtor),
      })),
    };
    this.verifications.set(
      this.scopedKey(organization.organizationId, verificationRef),
      {
        organizationId: organization.organizationId,
        debtorContext,
      },
    );

    return { verified: true, debtorContext };
  }

  async listDebts(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
  ): Promise<readonly DebtSummary[]> {
    const fixture = this.getOrganization(organization);
    this.assertVerifiedContext(organization, debtor);

    return fixture.creditors.flatMap((creditor) =>
      creditor.debtors
        .filter((candidate) =>
          this.isAuthorizedAccount(
            debtor,
            candidate.debtorRef,
            creditor.creditorRef,
          ),
        )
        .flatMap((candidate) =>
          candidate.debts.map(({ details }) => ({
            debtRef: details.debtRef,
            debtorRef: details.debtorRef,
            creditor: details.creditor,
            description: details.description,
            amount: details.amount,
            dueDate: details.dueDate,
            status: details.status,
          })),
        ),
    );
  }

  async getDebt(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    debtRef: string,
  ): Promise<DebtDetails> {
    return this.findDebt(organization, debtor, debtRef).details;
  }

  async listAuthorizedOffers(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    debtRef: string,
  ): Promise<readonly AuthorizedOffer[]> {
    return this.findDebt(organization, debtor, debtRef).offers.filter(
      (offer) => offer.status !== "DISABLED",
    );
  }

  async getAuthorizedOffer(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    offerRef: string,
  ): Promise<AuthorizedOffer> {
    const fixture = this.getOrganization(organization);
    this.assertVerifiedContext(organization, debtor);

    for (const creditor of fixture.creditors) {
      for (const candidate of creditor.debtors) {
        if (
          !this.isAuthorizedAccount(
            debtor,
            candidate.debtorRef,
            creditor.creditorRef,
          )
        ) {
          continue;
        }

        for (const debt of candidate.debts) {
          const offer = debt.offers.find(
            (candidateOffer) => candidateOffer.offerRef === offerRef,
          );
          if (offer) {
            return offer;
          }
        }
      }
    }

    throw this.notFound();
  }

  async acceptOffer(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: OfferAcceptanceInput,
  ): Promise<OfferAcceptanceResult> {
    assertIdempotencyKey(input.idempotencyKey);
    this.assertVerifiedContext(organization, debtor);

    return this.idempotent(
      organization,
      "ACCEPT_OFFER",
      input.idempotencyKey,
      {
        offerRef: input.offerRef,
        expectedProviderVersion: input.expectedProviderVersion,
        expectedTerms: input.expectedTerms,
      },
      () => {
        const fixture = this.findOffer(organization, debtor, input.offerRef);

        if (
          fixture.status !== "AVAILABLE" ||
          new Date(fixture.expiresAt).getTime() <= this.now().getTime()
        ) {
          throw new ApplicationError(
            "OFFER_EXPIRED",
            "A proposta não está mais disponível.",
            409,
          );
        }

        if (
          fixture.providerVersion !== input.expectedProviderVersion ||
          !sameValue(fixture.terms, input.expectedTerms)
        ) {
          throw new ApplicationError(
            "OFFER_CHANGED",
            "A proposta foi alterada e deve ser apresentada novamente.",
            409,
          );
        }

        const result: OfferAcceptanceResult = {
          acceptanceRef: opaqueRef(
            "acceptance",
            `${organization.organizationId}:${input.idempotencyKey}`,
          ),
          offerRef: fixture.offerRef,
          providerVersion: fixture.providerVersion,
          acceptedAt: input.acceptedAt,
        };
        this.acceptances.set(
          this.scopedKey(organization.organizationId, result.acceptanceRef),
          {
            organizationId: organization.organizationId,
            debtorRefs: debtor.authorizedAccounts.map(
              (account) => account.debtorRef,
            ),
            result,
          },
        );
        return result;
      },
    );
  }

  async createPaymentInstrument(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: Readonly<{
      idempotencyKey: string;
      acceptanceRef: string;
      type: DemoPaymentInstrumentType;
    }>,
  ): Promise<DemoPaymentInstrument> {
    assertIdempotencyKey(input.idempotencyKey);
    this.assertVerifiedContext(organization, debtor);

    return this.idempotent(
      organization,
      "CREATE_PAYMENT_INSTRUMENT",
      input.idempotencyKey,
      input,
      () => {
        const acceptance = this.acceptances.get(
          this.scopedKey(organization.organizationId, input.acceptanceRef),
        );
        if (
          !acceptance ||
          !acceptance.debtorRefs.some((ref) =>
            debtor.authorizedAccounts.some(
              (account) => account.debtorRef === ref,
            ),
          )
        ) {
          throw this.notFound();
        }

        const instrumentRef = opaqueRef(
          "instrument",
          `${organization.organizationId}:${input.idempotencyKey}`,
        );
        const values: Record<DemoPaymentInstrumentType, string> = {
          DEMO_LINK: `/demo/payment-instruments/${instrumentRef}`,
          DEMO_BOLETO: "LINHA-DIGITÁVEL-DEMO-INVÁLIDA",
          DEMO_PIX: "PIX-DEMO-INVÁLIDO-NÃO-PAGÁVEL",
        };

        return {
          instrumentRef,
          acceptanceRef: acceptance.result.acceptanceRef,
          type: input.type,
          displayValue: values[input.type],
          expiresAt: "2099-12-31T23:59:59.000Z",
          isDemo: true,
          warning: "DEMONSTRAÇÃO — SEM VALOR FINANCEIRO",
        };
      },
    );
  }

  async getPaymentStatus(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    debtRef: string,
  ): Promise<PaymentStatus> {
    this.findDebt(organization, debtor, debtRef);
    return {
      debtRef,
      status: "OPEN",
      updatedAt: this.now().toISOString(),
    };
  }

  async registerPaymentPromise(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: PaymentPromiseInput,
  ): Promise<PaymentPromiseResult> {
    assertIdempotencyKey(input.idempotencyKey);
    this.findDebt(organization, debtor, input.debtRef);
    return this.idempotent(
      organization,
      "REGISTER_PAYMENT_PROMISE",
      input.idempotencyKey,
      input,
      () => ({
        providerReference: opaqueRef(
          "promise",
          `${organization.organizationId}:${input.idempotencyKey}`,
        ),
        debtRef: input.debtRef,
        promisedDate: input.promisedDate,
        status: "RECORDED",
      }),
    );
  }

  async reportPayment(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: PaymentReportInput,
  ): Promise<PaymentReportResult> {
    assertIdempotencyKey(input.idempotencyKey);
    this.findDebt(organization, debtor, input.debtRef);
    return this.idempotent(
      organization,
      "REPORT_PAYMENT",
      input.idempotencyKey,
      input,
      () => ({
        providerReference: opaqueRef(
          "payment_report",
          `${organization.organizationId}:${input.idempotencyKey}`,
        ),
        debtRef: input.debtRef,
        status: "PENDING_REVIEW",
      }),
    );
  }

  async openDispute(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: DisputeInput,
  ): Promise<DisputeResult> {
    assertIdempotencyKey(input.idempotencyKey);
    this.findDebt(organization, debtor, input.debtRef);
    return this.idempotent(
      organization,
      "OPEN_DISPUTE",
      input.idempotencyKey,
      input,
      () => ({
        providerReference: opaqueRef(
          "dispute",
          `${organization.organizationId}:${input.idempotencyKey}`,
        ),
        debtRef: input.debtRef,
        status: "PENDING_REVIEW",
      }),
    );
  }

  private getOrganization(
    context: OrganizationContext,
  ): MockOrganizationFixture {
    assertOrganizationContext(context);
    const organization = this.organizations.find(
      (candidate) => candidate.organizationId === context.organizationId,
    );
    if (!organization) {
      throw this.notFound();
    }
    return organization;
  }

  private getIdentification(
    organization: OrganizationContext,
    identificationRef: string,
  ): IdentificationState {
    const storageKey = this.scopedKey(
      organization.organizationId,
      identificationRef,
    );
    const existing = this.identifications.get(storageKey);
    if (existing) {
      return existing;
    }

    const fixture = this.getOrganization(organization);
    const identifiers = new Set(
      fixture.creditors.flatMap((creditor) =>
        creditor.debtors.map((debtor) => debtor.demoIdentifier),
      ),
    );
    for (const identifier of identifiers) {
      const expectedRef = opaqueRef(
        "identification",
        `${organization.organizationId}:${identifier}`,
      );
      if (expectedRef !== identificationRef) {
        continue;
      }

      const debtors = fixture.creditors.flatMap((creditor) =>
        creditor.debtors.filter(
          (debtor) => debtor.demoIdentifier === identifier,
        ),
      );
      const restored: IdentificationState = {
        organizationId: organization.organizationId,
        identificationRef,
        debtors,
        attempts: 0,
        blocked: false,
      };
      this.identifications.set(storageKey, restored);
      return restored;
    }

    throw this.notFound();
  }

  private assertVerifiedContext(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
  ): void {
    const state = this.verifications.get(
      this.scopedKey(organization.organizationId, debtor.verificationRef),
    );
    if (
      !state ||
      state.organizationId !== organization.organizationId ||
      !sameValue(state.debtorContext, debtor)
    ) {
      throw new ApplicationError(
        "INVALID_DEBTOR_CONTEXT",
        "O contexto do devedor não é válido para esta organização.",
        403,
      );
    }
  }

  private findDebt(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    debtRef: string,
  ): Readonly<{
    details: DebtDetails;
    offers: readonly AuthorizedOffer[];
  }> {
    const fixture = this.getOrganization(organization);
    this.assertVerifiedContext(organization, debtor);

    for (const creditor of fixture.creditors) {
      for (const candidate of creditor.debtors) {
        if (
          !this.isAuthorizedAccount(
            debtor,
            candidate.debtorRef,
            creditor.creditorRef,
          )
        ) {
          continue;
        }
        const debt = candidate.debts.find(
          ({ details }) => details.debtRef === debtRef,
        );
        if (debt) {
          return debt;
        }
      }
    }
    throw this.notFound();
  }

  private findOffer(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    offerRef: string,
  ): AuthorizedOffer {
    const fixture = this.getOrganization(organization);
    this.assertVerifiedContext(organization, debtor);

    for (const creditor of fixture.creditors) {
      for (const candidate of creditor.debtors) {
        if (
          !this.isAuthorizedAccount(
            debtor,
            candidate.debtorRef,
            creditor.creditorRef,
          )
        ) {
          continue;
        }
        for (const debt of candidate.debts) {
          const offer = debt.offers.find(
            (candidateOffer) => candidateOffer.offerRef === offerRef,
          );
          if (offer) {
            return offer;
          }
        }
      }
    }
    throw this.notFound();
  }

  private isAuthorizedAccount(
    debtor: VerifiedDebtorContext,
    debtorRef: string,
    creditorRef: string,
  ): boolean {
    return debtor.authorizedAccounts.some(
      (account) =>
        account.debtorRef === debtorRef &&
        account.creditorRef === creditorRef,
    );
  }

  private findCreditorRef(
    organization: MockOrganizationFixture,
    debtor: MockDebtorFixture,
  ): string {
    const creditor = organization.creditors.find((candidate) =>
      candidate.debtors.includes(debtor),
    );
    if (!creditor) {
      throw new Error("Fixture de devedor sem credor.");
    }
    return creditor.creditorRef;
  }

  private idempotent<Result>(
    organization: OrganizationContext,
    operation: string,
    key: string,
    payload: unknown,
    execute: () => Result,
  ): Result {
    const storageKey = this.scopedKey(
      organization.organizationId,
      `${operation}:${key}`,
    );
    const digest = payloadDigest(payload);
    const existing = this.idempotency.get(storageKey);

    if (existing) {
      if (existing.payloadDigest !== digest) {
        throw new ApplicationError(
          "IDEMPOTENCY_CONFLICT",
          "A chave de idempotência já foi usada com outro conteúdo.",
          409,
        );
      }
      return existing.result as Result;
    }

    const result = execute();
    this.idempotency.set(storageKey, { payloadDigest: digest, result });
    return result;
  }

  private scopedKey(organizationId: string, reference: string): string {
    return `${organizationId}:${reference}`;
  }

  private notFound(): ApplicationError {
    return new ApplicationError(
      "RESOURCE_NOT_FOUND",
      "Recurso não encontrado.",
      404,
    );
  }
}
