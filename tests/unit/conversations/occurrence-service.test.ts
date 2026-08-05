import { describe, expect, it } from "vitest";

import type { IdempotencyScope } from "@/modules/conversations/acceptance-store";
import type { ConversationStore } from "@/modules/conversations/conversation-store";
import type {
  OccurrenceRecord,
  OccurrenceResponse,
  OccurrenceStore,
} from "@/modules/conversations/occurrence-store";
import { OccurrenceService } from "@/modules/conversations/occurrence-service";
import type {
  AuditInput,
  PersistedConversation,
  PersistedOrganization,
} from "@/modules/conversations/persistence.types";
import { MockDebtProvider } from "@/modules/debt-provider/mock/mock-debt-provider";
import { hashSessionToken } from "@/shared/auth/session-token";
import { ApplicationError } from "@/shared/errors/application-error";

const now = new Date("2026-07-30T12:00:00.000Z");
const sessionSecret = "session-test-secret-with-at-least-32-characters";
const idempotencySecret =
  "dedicated-idempotency-secret-with-at-least-sixty-four-characters-000000";
const token = "session-token";
const rawKey = "client-occurrence-key-0001";

class ConversationMemoryStore implements ConversationStore {
  constructor(readonly conversation: PersistedConversation) {}
  async findActiveOrganizationBySlug(): Promise<PersistedOrganization | null> {
    return null;
  }
  async createConversation(): Promise<PersistedConversation> {
    throw new Error("not implemented");
  }
  async authenticateConversation(
    reference: string,
    tokenHash: string,
    startedAfter: Date,
  ) {
    return reference === this.conversation.publicReference &&
      tokenHash === hashSessionToken(token, sessionSecret) &&
      this.conversation.startedAt >= startedAfter
      ? this.conversation
      : null;
  }
  async recordIdentification(): Promise<PersistedConversation> {
    throw new Error("not implemented");
  }
  async recordIdentityAttempt(): Promise<PersistedConversation> {
    throw new Error("not implemented");
  }
  async recordAudit(): Promise<void> {}
  async recordTerminalState(): Promise<PersistedConversation> {
    throw new Error("not implemented");
  }
}

class OccurrenceMemoryStore implements OccurrenceStore {
  readonly records = new Map<
    string,
    { fingerprint: string; response: OccurrenceResponse }
  >();
  readonly occurrences: OccurrenceRecord[] = [];
  readonly audits: AuditInput[] = [];
  failOnce = false;

  async findResult(scope: IdempotencyScope) {
    const existing = this.records.get(this.key(scope));
    if (existing && existing.fingerprint !== scope.requestFingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Conflito.", 409);
    }
    return existing?.response ?? null;
  }

  async finalize(input: Parameters<OccurrenceStore["finalize"]>[0]) {
    if (this.failOnce) {
      this.failOnce = false;
      throw new Error("falha local simulada");
    }
    const key = this.key(input.scope);
    const existing = this.records.get(key);
    if (existing) {
      if (existing.fingerprint !== input.scope.requestFingerprint) {
        throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Conflito.", 409);
      }
      return existing.response;
    }
    this.records.set(key, {
      fingerprint: input.scope.requestFingerprint,
      response: input.response,
    });
    this.occurrences.push(input.occurrence);
    this.audits.push(input.audit);
    return input.response;
  }

  private key(scope: IdempotencyScope) {
    return [
      scope.organizationId,
      scope.operation,
      scope.resourceRef,
      scope.keyHash,
    ].join(":");
  }
}

async function setup(overrides: Partial<PersistedConversation> = {}) {
  const provider = new MockDebtProvider();
  const organization = {
    organizationId: "org-jf-demo",
    requestId: "setup",
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
  if (!verification.verified) throw new Error("fixture inválida");

  const conversation: PersistedConversation = {
    id: "conversation-internal-001",
    organizationId: "org-jf-demo",
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
    ...overrides,
  };
  const store = new OccurrenceMemoryStore();
  const service = new OccurrenceService(
    new ConversationMemoryStore(conversation),
    store,
    provider,
    sessionSecret,
    idempotencySecret,
    3_600,
    () => now,
  );
  const common = {
    publicReference: conversation.publicReference,
    token,
    debtRef: "debt-001",
    idempotencyKey: rawKey,
    requestId: "request-001",
  };
  return { service, store, common };
}

describe("OccurrenceService", () => {
  it("persists a promise with the organization time zone and no raw key", async () => {
    const { service, store, common } = await setup();
    const result = await service.registerPaymentPromise({
      ...common,
      request: { promisedDate: "2026-08-10" },
    });
    expect(result.promise.status).toBe("RECORDED");
    expect(store.occurrences[0]).toMatchObject({
      kind: "PAYMENT_PROMISE",
      timeZone: "America/Sao_Paulo",
    });
    expect(JSON.stringify(store)).not.toContain(rawKey);
  });

  it("preserves reportedAt, adds receivedAt and never confirms payment", async () => {
    const { service, store, common } = await setup();
    const reportedAt = "2026-07-29T20:00:00.000Z";
    const result = await service.reportPayment({
      ...common,
      request: { reportedAt },
    });
    expect(result.report).toMatchObject({
      reportedAt,
      receivedAt: now.toISOString(),
      status: "PENDING_REVIEW",
      warning: "PAGAMENTO INFORMADO — NÃO CONFIRMADO",
    });
    expect(store.audits[0].metadata).toMatchObject({ confirmed: false });
  });

  it("does not copy the dispute description into audit or response", async () => {
    const { service, store, common } = await setup();
    const description = "Texto confidencial curto da contestação.";
    const result = await service.openDispute({
      ...common,
      request: { reasonCode: "OTHER", description },
    });
    expect(JSON.stringify(result)).not.toContain(description);
    expect(JSON.stringify(store.audits)).not.toContain(description);
    expect(store.occurrences[0]).toMatchObject({ description });
  });

  it("reconciles provider success after a local persistence failure", async () => {
    const { service, store, common } = await setup();
    store.failOnce = true;
    const request = {
      ...common,
      request: { promisedDate: "2026-08-10" },
    };
    await expect(service.registerPaymentPromise(request)).rejects.toThrow(
      "falha local simulada",
    );
    const recovered = await service.registerPaymentPromise(request);
    expect(recovered.promise.status).toBe("RECORDED");
    expect(store.occurrences).toHaveLength(1);
  });

  it("requires cookie, verified identity and an active negotiation", async () => {
    const { service, common } = await setup();
    await expect(
      service.reportPayment({
        ...common,
        token: undefined,
        request: { reportedAt: now.toISOString() },
      }),
    ).rejects.toMatchObject({ code: "SESSION_REQUIRED" });

    const optedOut = await setup({ state: "OPTED_OUT", optedOutAt: now });
    await expect(
      optedOut.service.openDispute({
        ...optedOut.common,
        request: { reasonCode: "NOT_RECOGNIZED" },
      }),
    ).rejects.toMatchObject({ code: "MESSAGING_OPTED_OUT" });

    const closed = await setup({ state: "CLOSED", endedAt: now });
    await expect(
      closed.service.reportPayment({
        ...closed.common,
        request: { reportedAt: now.toISOString() },
      }),
    ).rejects.toMatchObject({ code: "CONVERSATION_CLOSED" });
  });

  it("scopes a key by operation and rejects a changed payload", async () => {
    const { service, common } = await setup();
    await service.registerPaymentPromise({
      ...common,
      request: { promisedDate: "2026-08-10" },
    });
    await expect(
      service.registerPaymentPromise({
        ...common,
        request: { promisedDate: "2026-08-11" },
      }),
    ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    const report = await service.reportPayment({
      ...common,
      request: { reportedAt: now.toISOString() },
    });
    expect(report.report.status).toBe("PENDING_REVIEW");
  });

  it("returns one deterministic result for simultaneous retries", async () => {
    const { service, store, common } = await setup();
    const request = {
      ...common,
      request: { promisedDate: "2026-08-10" },
    };
    const [first, second] = await Promise.all([
      service.registerPaymentPromise(request),
      service.registerPaymentPromise(request),
    ]);
    expect(second).toEqual(first);
    expect(store.occurrences).toHaveLength(1);
    expect(store.audits).toHaveLength(1);
  });
});
