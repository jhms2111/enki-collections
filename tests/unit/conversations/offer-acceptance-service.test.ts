import { describe, expect, it } from "vitest";

import { MockDebtProvider } from "@/modules/debt-provider/mock/mock-debt-provider";
import type {
  DemoPaymentInstrument,
  OfferAcceptanceInput,
  OfferAcceptanceResult,
  VerifiedDebtorContext,
} from "@/modules/debt-provider/debt-provider.types";
import type { OrganizationContext } from "@/modules/organizations/organization-context";
import type {
  AcceptanceResponse,
  InstrumentResponse,
} from "@/modules/conversations/acceptance.schemas";
import type {
  AcceptanceStore,
  IdempotencyScope,
  PersistedOfferAcceptance,
} from "@/modules/conversations/acceptance-store";
import type { ConversationStore } from "@/modules/conversations/conversation-store";
import { OfferAcceptanceService } from "@/modules/conversations/offer-acceptance-service";
import type {
  AuditInput,
  PersistedConversation,
  PersistedOrganization,
} from "@/modules/conversations/persistence.types";
import { hashSessionToken } from "@/shared/auth/session-token";
import { ApplicationError } from "@/shared/errors/application-error";

const now = new Date("2026-07-30T12:00:00.000Z");
const secret = "acceptance-test-secret-with-at-least-32-characters";
const idempotencySecret =
  "idempotency-test-secret-with-at-least-sixty-four-characters-0000000000";
const rawKey = "client-key-acceptance-0001";
const token = "test-session-token";

class TestConversationStore implements ConversationStore {
  constructor(readonly conversation: PersistedConversation) {}

  async findActiveOrganizationBySlug(
    slug: string,
  ): Promise<PersistedOrganization | null> {
    void slug;
    return null;
  }

  async createConversation(): Promise<PersistedConversation> {
    throw new Error("Not implemented in this test.");
  }

  async authenticateConversation(
    publicReference: string,
    sessionTokenHash: string,
    startedAfter: Date,
  ) {
    return publicReference === this.conversation.publicReference &&
      sessionTokenHash === hashSessionToken(token, secret) &&
      this.conversation.startedAt >= startedAfter
      ? this.conversation
      : null;
  }

  async recordIdentification(): Promise<PersistedConversation> {
    throw new Error("Not implemented in this test.");
  }

  async recordIdentityAttempt(): Promise<PersistedConversation> {
    throw new Error("Not implemented in this test.");
  }

  async recordAudit(): Promise<void> {}
  async recordTerminalState(): Promise<PersistedConversation> {
    throw new Error("Not implemented in this test.");
  }
}

class TestAcceptanceStore implements AcceptanceStore {
  readonly idempotency = new Map<
    string,
    {
      fingerprint: string;
      response: AcceptanceResponse | InstrumentResponse;
    }
  >();
  readonly acceptances = new Map<string, PersistedOfferAcceptance>();
  readonly audits: AuditInput[] = [];
  acceptanceCreates = 0;
  failAcceptanceOnce = false;

  async findAcceptanceResult(scope: IdempotencyScope) {
    const record = this.findRecord(scope);
    return record?.response as AcceptanceResponse | null;
  }

  async finalizeAcceptance(input: {
    scope: IdempotencyScope;
    conversation: PersistedConversation;
    acceptance: PersistedOfferAcceptance;
    response: AcceptanceResponse;
    audit: AuditInput;
  }) {
    if (this.failAcceptanceOnce) {
      this.failAcceptanceOnce = false;
      throw new Error("Simulated local persistence failure.");
    }
    await Promise.resolve();
    const existing = this.findRecord(input.scope);
    if (existing) {
      return existing.response as AcceptanceResponse;
    }
    this.idempotency.set(this.scopeKey(input.scope), {
      fingerprint: input.scope.requestFingerprint,
      response: input.response,
    });
    this.acceptances.set(
      input.acceptance.publicReference,
      input.acceptance,
    );
    this.audits.push(input.audit);
    this.acceptanceCreates += 1;
    return input.response;
  }

  async findAcceptance(
    conversation: PersistedConversation,
    publicReference: string,
  ) {
    const acceptance = this.acceptances.get(publicReference);
    return acceptance?.organizationId === conversation.organizationId &&
      acceptance.conversationId === conversation.id
      ? acceptance
      : null;
  }

  async findInstrumentResult(scope: IdempotencyScope) {
    const record = this.findRecord(scope);
    return record?.response as InstrumentResponse | null;
  }

  async finalizeInstrument(input: {
    scope: IdempotencyScope;
    conversation: PersistedConversation;
    response: InstrumentResponse;
    audit: AuditInput;
    expiresAt: Date;
  }) {
    await Promise.resolve();
    const existing = this.findRecord(input.scope);
    if (existing) {
      return existing.response as InstrumentResponse;
    }
    this.idempotency.set(this.scopeKey(input.scope), {
      fingerprint: input.scope.requestFingerprint,
      response: input.response,
    });
    this.audits.push(input.audit);
    return input.response;
  }

  private findRecord(scope: IdempotencyScope) {
    const record = this.idempotency.get(this.scopeKey(scope));
    if (
      record &&
      record.fingerprint !== scope.requestFingerprint
    ) {
      throw new ApplicationError(
        "IDEMPOTENCY_CONFLICT",
        "Conflito idempotente.",
        409,
      );
    }
    return record ?? null;
  }

  private scopeKey(scope: IdempotencyScope) {
    return [
      scope.organizationId,
      scope.operation,
      scope.resourceRef,
      scope.keyHash,
    ].join(":");
  }
}

class CountingMockDebtProvider extends MockDebtProvider {
  acceptCalls = 0;
  instrumentCalls = 0;
  acceptanceRefs: string[] = [];

  override async acceptOffer(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: OfferAcceptanceInput,
  ): Promise<OfferAcceptanceResult> {
    this.acceptCalls += 1;
    const result = await super.acceptOffer(organization, debtor, input);
    this.acceptanceRefs.push(result.acceptanceRef);
    return result;
  }

  override async createPaymentInstrument(
    organization: OrganizationContext,
    debtor: VerifiedDebtorContext,
    input: Readonly<{
      idempotencyKey: string;
      acceptanceRef: string;
      type: "DEMO_LINK" | "DEMO_BOLETO" | "DEMO_PIX";
    }>,
  ): Promise<DemoPaymentInstrument> {
    this.instrumentCalls += 1;
    return super.createPaymentInstrument(organization, debtor, input);
  }
}

class UnsafeInstrumentProvider extends CountingMockDebtProvider {
  override async createPaymentInstrument(
    _organization: OrganizationContext,
    _debtor: VerifiedDebtorContext,
    input: Readonly<{
      idempotencyKey: string;
      acceptanceRef: string;
      type: "DEMO_LINK" | "DEMO_BOLETO" | "DEMO_PIX";
    }>,
  ): Promise<DemoPaymentInstrument> {
    return {
      instrumentRef: "unsafe-instrument",
      acceptanceRef: input.acceptanceRef,
      type: input.type,
      displayValue: "000201VALID-LOOKING-PIX",
      expiresAt: "2099-12-31T23:59:59.000Z",
      isDemo: true,
      warning: "DEMONSTRAÇÃO — SEM VALOR FINANCEIRO",
    };
  }
}

async function createSetup(provider = new CountingMockDebtProvider()) {
  const organization: OrganizationContext = {
    organizationId: "org-jf-demo",
    requestId: "setup-request",
  };
  const identification = await provider.identifyDebtor(organization, {
    type: "DEMO_ID",
    value: "DEMO-AURORA-001",
  });
  const challenge = await provider.getIdentityChallenge(
    organization,
    identification!.identificationRef,
  );
  const verification = await provider.verifyIdentity(
    organization,
    identification!.identificationRef,
    challenge.challengeRef,
    "option-green",
  );
  if (!verification.verified) {
    throw new Error("Fixture de identidade inválida.");
  }
  const conversation: PersistedConversation = {
    id: "conversation-internal-001",
    organizationId: organization.organizationId,
    organizationExternalRef: "ext-demo",
    organizationTimeZone: "America/Sao_Paulo",
    publicReference: "conv_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    state: "IDENTITY_VERIFIED",
    debtorRef: "debtor-001",
    verifiedDebtorContext: verification.debtorContext,
    identityStatus: "VERIFIED",
    failedIdentityAttempts: 0,
    identityLockedAt: null,
    startedAt: now,
    lastActivityAt: now,
    endedAt: null,
    optedOutAt: null,
    messages: [],
  };
  const conversationStore = new TestConversationStore(conversation);
  const acceptanceStore = new TestAcceptanceStore();
  const service = new OfferAcceptanceService(
    conversationStore,
    acceptanceStore,
    provider,
    secret,
    idempotencySecret,
    3_600,
    () => now,
  );
  const offer = await provider.getAuthorizedOffer(
    organization,
    verification.debtorContext,
    "offer-cash-001",
  );
  const request = {
    confirmation: true as const,
    expectedProviderVersion: offer.providerVersion,
    expectedTerms: offer.terms,
  };
  return {
    service,
    provider,
    acceptanceStore,
    conversation,
    request,
  };
}

async function acceptDefault(
  setup: Awaited<ReturnType<typeof createSetup>>,
  idempotencyKey = rawKey,
) {
  return setup.service.acceptOffer({
    publicReference: setup.conversation.publicReference,
    token,
    debtRef: "debt-001",
    offerRef: "offer-cash-001",
    idempotencyKey,
    request: setup.request,
    requestId: "request-accept",
  });
}

describe("OfferAcceptanceService", () => {
  it("requires an authenticated cookie and verified identity", async () => {
    const setup = await createSetup();
    await expect(
      setup.service.acceptOffer({
        publicReference: setup.conversation.publicReference,
        token: undefined,
        debtRef: "debt-001",
        offerRef: "offer-cash-001",
        idempotencyKey: rawKey,
        request: setup.request,
        requestId: "request-without-cookie",
      }),
    ).rejects.toMatchObject({ code: "SESSION_REQUIRED", status: 401 });

    const closedConversation: PersistedConversation = {
      ...setup.conversation,
      state: "CLOSED",
      endedAt: now,
    };
    const closedService = new OfferAcceptanceService(
      new TestConversationStore(closedConversation),
      setup.acceptanceStore,
      setup.provider,
      secret,
      idempotencySecret,
      3_600,
      () => now,
    );
    await expect(
      closedService.acceptOffer({
        publicReference: closedConversation.publicReference,
        token,
        debtRef: "debt-001",
        offerRef: "offer-cash-001",
        idempotencyKey: rawKey,
        request: setup.request,
        requestId: "request-closed",
      }),
    ).rejects.toMatchObject({ code: "CONVERSATION_CLOSED" });

    const unverifiedConversation: PersistedConversation = {
      ...setup.conversation,
      state: "STARTED",
      identityStatus: "NOT_STARTED",
      verifiedDebtorContext: null,
    };
    const unverifiedService = new OfferAcceptanceService(
      new TestConversationStore(unverifiedConversation),
      setup.acceptanceStore,
      setup.provider,
      secret,
      idempotencySecret,
      3_600,
      () => now,
    );
    await expect(
      unverifiedService.acceptOffer({
        publicReference: unverifiedConversation.publicReference,
        token,
        debtRef: "debt-001",
        offerRef: "offer-cash-001",
        idempotencyKey: rawKey,
        request: setup.request,
        requestId: "request-unverified",
      }),
    ).rejects.toMatchObject({
      code: "IDENTITY_VERIFICATION_REQUIRED",
      status: 403,
    });
  });

  it("persists one authorized acceptance without storing the raw key", async () => {
    const setup = await createSetup();
    const result = await acceptDefault(setup);
    const persisted = [...setup.acceptanceStore.acceptances.values()][0];
    const serializedStore = JSON.stringify({
      idempotency: [...setup.acceptanceStore.idempotency.entries()],
      acceptances: [...setup.acceptanceStore.acceptances.entries()],
      audits: setup.acceptanceStore.audits,
    });

    expect(result.acceptance.providerVersion).toBe("offer-v3");
    expect(persisted.termsSnapshot).toEqual(setup.request.expectedTerms);
    expect(setup.acceptanceStore.acceptanceCreates).toBe(1);
    expect(serializedStore).not.toContain(rawKey);
  });

  it("returns one deterministic response under simultaneous concurrency", async () => {
    const setup = await createSetup();
    const responses = await Promise.all([
      acceptDefault(setup),
      acceptDefault(setup),
      acceptDefault(setup),
    ]);

    expect(new Set(responses.map((item) => item.acceptance.id)).size).toBe(1);
    expect(setup.acceptanceStore.acceptanceCreates).toBe(1);
    expect(new Set(setup.provider.acceptanceRefs).size).toBe(1);
  });

  it("scopes the same client key independently to each offer resource", async () => {
    const setup = await createSetup();
    const first = await acceptDefault(setup);
    const organization = {
      organizationId: "org-jf-demo",
      requestId: "request-installment",
    };
    const installment = await setup.provider.getAuthorizedOffer(
      organization,
      setup.conversation
        .verifiedDebtorContext as VerifiedDebtorContext,
      "offer-installment-001",
    );
    const second = await setup.service.acceptOffer({
      publicReference: setup.conversation.publicReference,
      token,
      debtRef: "debt-001",
      offerRef: "offer-installment-001",
      idempotencyKey: rawKey,
      request: {
        confirmation: true,
        expectedProviderVersion: installment.providerVersion,
        expectedTerms: installment.terms,
      },
      requestId: "request-installment-accept",
    });

    expect(first.acceptance.id).not.toBe(second.acceptance.id);
    expect(setup.acceptanceStore.acceptanceCreates).toBe(2);
  });

  it("reconciles the same provider acceptance after a local failure", async () => {
    const setup = await createSetup();
    setup.acceptanceStore.failAcceptanceOnce = true;

    await expect(acceptDefault(setup)).rejects.toThrow(
      "Simulated local persistence failure.",
    );
    const recovered = await acceptDefault(setup);

    expect(recovered.acceptance.offerRef).toBe("offer-cash-001");
    expect(setup.provider.acceptCalls).toBe(2);
    expect(new Set(setup.provider.acceptanceRefs).size).toBe(1);
    expect(setup.acceptanceStore.acceptanceCreates).toBe(1);
  });

  it("rejects reuse of the same scoped key with changed terms", async () => {
    const setup = await createSetup();
    await acceptDefault(setup);

    await expect(
      setup.service.acceptOffer({
        publicReference: setup.conversation.publicReference,
        token,
        debtRef: "debt-001",
        offerRef: "offer-cash-001",
        idempotencyKey: rawKey,
        request: {
          ...setup.request,
          expectedTerms: {
            ...setup.request.expectedTerms,
            total: { amountInCents: 1, currency: "BRL" },
          },
        },
        requestId: "request-conflict",
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
  });

  it("rejects altered and expired provider offers", async () => {
    const altered = await createSetup();
    await expect(
      altered.service.acceptOffer({
        publicReference: altered.conversation.publicReference,
        token,
        debtRef: "debt-001",
        offerRef: "offer-cash-001",
        idempotencyKey: "altered-acceptance-key-001",
        request: {
          ...altered.request,
          expectedProviderVersion: "wrong-version",
        },
        requestId: "request-altered",
      }),
    ).rejects.toMatchObject({ code: "OFFER_CHANGED" });

    const expired = await createSetup();
    const expiredOffer = await expired.provider.getAuthorizedOffer(
      { organizationId: "org-jf-demo", requestId: "expired" },
      expired.conversation
        .verifiedDebtorContext as VerifiedDebtorContext,
      "offer-expired-001",
    );
    await expect(
      expired.service.acceptOffer({
        publicReference: expired.conversation.publicReference,
        token,
        debtRef: "debt-001",
        offerRef: "offer-expired-001",
        idempotencyKey: "expired-acceptance-key-001",
        request: {
          confirmation: true,
          expectedProviderVersion: expiredOffer.providerVersion,
          expectedTerms: expiredOffer.terms,
        },
        requestId: "request-expired",
      }),
    ).rejects.toMatchObject({ code: "OFFER_EXPIRED" });
  });

  it("durably replays a demonstration instrument after provider restart", async () => {
    const setup = await createSetup();
    const acceptance = await acceptDefault(setup);
    const first = await setup.service.createInstrument({
      publicReference: setup.conversation.publicReference,
      token,
      acceptanceReference: acceptance.acceptance.id,
      type: "DEMO_PIX",
      idempotencyKey: "instrument-durable-key-001",
      requestId: "request-instrument",
    });
    const restartedProvider = new CountingMockDebtProvider();
    const restartedService = new OfferAcceptanceService(
      new TestConversationStore(setup.conversation),
      setup.acceptanceStore,
      restartedProvider,
      secret,
      idempotencySecret,
      3_600,
      () => now,
    );
    const replayed = await restartedService.createInstrument({
      publicReference: setup.conversation.publicReference,
      token,
      acceptanceReference: acceptance.acceptance.id,
      type: "DEMO_PIX",
      idempotencyKey: "instrument-durable-key-001",
      requestId: "request-instrument-retry",
    });

    expect(replayed).toEqual(first);
    expect(restartedProvider.instrumentCalls).toBe(0);
    expect(first.instrument.displayValue).not.toMatch(/^000201/);
    expect(first.instrument.warning).toBe(
      "DEMONSTRAÇÃO — SEM VALOR FINANCEIRO",
    );
  });

  it("rejects a provider instrument that could resemble a payable Pix", async () => {
    const setup = await createSetup(new UnsafeInstrumentProvider());
    const acceptance = await acceptDefault(setup);

    await expect(
      setup.service.createInstrument({
        publicReference: setup.conversation.publicReference,
        token,
        acceptanceReference: acceptance.acceptance.id,
        type: "DEMO_PIX",
        idempotencyKey: "unsafe-instrument-key-001",
        requestId: "request-unsafe-instrument",
      }),
    ).rejects.toMatchObject({
      code: "UNSAFE_DEMO_INSTRUMENT",
      status: 502,
    });
    expect(
      [...setup.acceptanceStore.idempotency.values()].some(({ response }) =>
        JSON.stringify(response).includes("000201"),
      ),
    ).toBe(false);
  });
});
