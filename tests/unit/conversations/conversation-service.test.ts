import { describe, expect, it, vi } from "vitest";

import type { ConversationStore } from "@/modules/conversations/conversation-store";
import { ConversationService } from "@/modules/conversations/conversation-service";
import {
  demoIdentifierSchema,
  identityVerificationSchema,
  organizationSlugSchema,
  publicIdentityChallengeSchema,
  terminalConversationCommandSchema,
} from "@/modules/conversations/conversation.schemas";
import type {
  AuditInput,
  PersistedConversation,
  PersistedOrganization,
} from "@/modules/conversations/persistence.types";
import { MockDebtProvider } from "@/modules/debt-provider/mock/mock-debt-provider";
import { hashSessionToken } from "@/shared/auth/session-token";

const sessionSecret = "test-session-secret-with-at-least-32-characters";
const fixedNow = new Date("2026-07-30T10:00:00.000Z");

class MemoryConversationStore implements ConversationStore {
  readonly organizations = new Map<string, PersistedOrganization>([
    [
      "jf-demo",
      {
        id: "org-jf-demo",
        slug: "jf-demo",
        externalRef: "org-demo-jf-collections",
        name: "JF Demo — Organização Fictícia",
        status: "ACTIVE",
      },
    ],
    [
      "atlas-demo",
      {
        id: "org-atlas-demo",
        slug: "atlas-demo",
        externalRef: "org-demo-atlas-collections",
        name: "Atlas Demo — Organização Fictícia",
        status: "ACTIVE",
      },
    ],
  ]);
  readonly conversations = new Map<
    string,
    PersistedConversation & { sessionTokenHash: string }
  >();
  readonly audits: AuditInput[] = [];

  async findActiveOrganizationBySlug(slug: string) {
    return this.organizations.get(slug) ?? null;
  }

  async createConversation(input: {
    organization: PersistedOrganization;
    publicReference: string;
    sessionTokenHash: string;
    now: Date;
    welcomeMessage: string;
    audit: AuditInput;
  }) {
    const conversation = {
      id: `internal-${input.publicReference}`,
      organizationId: input.organization.id,
      organizationExternalRef: input.organization.externalRef,
      organizationTimeZone: "America/Sao_Paulo",
      publicReference: input.publicReference,
      sessionTokenHash: input.sessionTokenHash,
      state: "STARTED" as const,
      debtorRef: null,
      verifiedDebtorContext: null,
      identityStatus: "NOT_STARTED" as const,
      failedIdentityAttempts: 0,
      identityLockedAt: null,
      startedAt: input.now,
      lastActivityAt: input.now,
      endedAt: null,
      optedOutAt: null,
      messages: [
        {
          direction: "OUTBOUND" as const,
          actor: "SYSTEM" as const,
          content: input.welcomeMessage,
          intent: null,
          createdAt: input.now,
        },
      ],
    };
    this.conversations.set(input.publicReference, conversation);
    this.audits.push(input.audit);
    return conversation;
  }

  async authenticateConversation(
    publicReference: string,
    sessionTokenHash: string,
    startedAfter: Date,
  ) {
    const conversation = this.conversations.get(publicReference);
    return conversation?.sessionTokenHash === sessionTokenHash &&
      conversation.startedAt >= startedAfter
      ? conversation
      : null;
  }

  async recordIdentification(input: {
    conversation: PersistedConversation;
    identificationRef: string;
    now: Date;
    audit: AuditInput;
  }) {
    const current = this.require(input.conversation.publicReference);
    const updated = {
      ...current,
      state: "IDENTIFIED" as const,
      identityStatus: "PENDING" as const,
      debtorRef: input.identificationRef,
      lastActivityAt: input.now,
    };
    this.conversations.set(updated.publicReference, updated);
    this.audits.push(input.audit);
    return updated;
  }

  async recordIdentityAttempt(input: {
    conversation: PersistedConversation;
    verified: boolean;
    verifiedDebtorRef?: string;
    verifiedDebtorContext?: import("@/modules/debt-provider/debt-provider.types").VerifiedDebtorContext;
    maxAttempts: number;
    now: Date;
    audit: AuditInput;
  }) {
    const current = this.require(input.conversation.publicReference);
    const failedAttempts = input.verified
      ? current.failedIdentityAttempts
      : current.failedIdentityAttempts + 1;
    const blocked = failedAttempts >= input.maxAttempts;
    const updated = {
      ...current,
      state: input.verified
        ? ("IDENTITY_VERIFIED" as const)
        : blocked
          ? ("IDENTITY_BLOCKED" as const)
          : ("IDENTIFIED" as const),
      identityStatus: input.verified
        ? ("VERIFIED" as const)
        : blocked
          ? ("BLOCKED" as const)
          : ("PENDING" as const),
      debtorRef: input.verified ? input.verifiedDebtorRef! : current.debtorRef,
      verifiedDebtorContext: input.verified
        ? input.verifiedDebtorContext!
        : current.verifiedDebtorContext,
      failedIdentityAttempts: failedAttempts,
      identityLockedAt: blocked ? input.now : null,
      lastActivityAt: input.now,
    };
    this.conversations.set(updated.publicReference, updated);
    this.audits.push({
      ...input.audit,
      metadata: {
        ...input.audit.metadata,
        failedAttempts,
        blocked,
      },
    });
    return updated;
  }

  async recordAudit(input: {
    conversation: PersistedConversation;
    audit: AuditInput;
  }) {
    this.audits.push(input.audit);
  }

  async recordTerminalState(input: {
    conversation: PersistedConversation;
    state: "CLOSED" | "OPTED_OUT";
    now: Date;
    audit: AuditInput;
  }) {
    const current = this.require(input.conversation.publicReference);
    if (current.state === "CLOSED" || current.state === "OPTED_OUT") {
      return current;
    }
    const updated = {
      ...current,
      state: input.state,
      endedAt: input.now,
      optedOutAt: input.state === "OPTED_OUT" ? input.now : null,
      lastActivityAt: input.now,
    };
    this.conversations.set(updated.publicReference, updated);
    this.audits.push(input.audit);
    return updated;
  }

  private require(publicReference: string) {
    const conversation = this.conversations.get(publicReference);
    if (!conversation) {
      throw new Error("Conversa de teste não encontrada.");
    }
    return conversation;
  }
}

function setup() {
  const store = new MemoryConversationStore();
  const provider = new MockDebtProvider(undefined, () => fixedNow);
  const service = new ConversationService(
    store,
    provider,
    sessionSecret,
    3,
    3_600,
    () => fixedNow,
  );
  return { store, provider, service };
}

async function createAndIdentify() {
  const context = setup();
  const created = await context.service.create("jf-demo");
  const identified = await context.service.identify(
    created.conversation.id,
    created.token,
    "DEMO-AURORA-001",
    "request-identify",
  );
  return { ...context, created, identified };
}

describe("ConversationService", () => {
  it("creates a conversation with a strong token stored only as a hash", async () => {
    const { store, service } = setup();
    const result = await service.create("jf-demo");
    const stored = store.conversations.get(result.conversation.id)!;

    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored.sessionTokenHash).toHaveLength(64);
    expect(stored.sessionTokenHash).toBe(
      hashSessionToken(result.token, sessionSecret),
    );
    expect(JSON.stringify(stored)).not.toContain(result.token);
    expect(store.audits.at(-1)?.eventType).toBe("CONVERSATION_CREATED");
  });

  it("does not authenticate from a conversation reference alone", async () => {
    const { service } = setup();
    const created = await service.create("jf-demo");

    await expect(
      service.get(created.conversation.id, undefined),
    ).rejects.toMatchObject({ code: "SESSION_REQUIRED", status: 401 });
  });

  it("rejects an incorrect cookie token", async () => {
    const { service } = setup();
    const created = await service.create("jf-demo");

    await expect(
      service.get(created.conversation.id, "incorrect-token"),
    ).rejects.toMatchObject({ code: "SESSION_INVALID", status: 401 });
  });

  it("rejects an otherwise valid token after the server-side expiry", async () => {
    const store = new MemoryConversationStore();
    const provider = new MockDebtProvider(undefined, () => fixedNow);
    const creationService = new ConversationService(
      store,
      provider,
      sessionSecret,
      3,
      3_600,
      () => fixedNow,
    );
    const created = await creationService.create("jf-demo");
    const expiredService = new ConversationService(
      store,
      provider,
      sessionSecret,
      3,
      3_600,
      () => new Date(fixedNow.getTime() + 3_601_000),
    );

    await expect(
      expiredService.get(created.conversation.id, created.token),
    ).rejects.toMatchObject({ code: "SESSION_INVALID", status: 401 });
  });

  it("isolates tokens and conversations between organizations", async () => {
    const { service } = setup();
    const jf = await service.create("jf-demo");
    const atlas = await service.create("atlas-demo");

    await expect(
      service.get(atlas.conversation.id, jf.token),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("identifies a fictional identifier and exposes only the public challenge", async () => {
    const { store, identified } = await createAndIdentify();
    const serialized = JSON.stringify(identified);

    expect(identified.verificationRequired).toBe(true);
    expect(identified.conversation.identityStatus).toBe("PENDING");
    expect(
      publicIdentityChallengeSchema.parse(identified.challenge),
    ).toEqual(identified.challenge);
    expect(identified.challenge.prompt).toBeTruthy();
    expect(identified.challenge.options).toHaveLength(3);
    expect(identified.challenge.attemptsRemaining).toBe(3);
    expect(serialized).not.toContain("challengeRef");
    expect(serialized).not.toContain("correctOptionRef");
    expect(serialized).not.toContain("debt-");
    expect(serialized).not.toContain("amountInCents");
    expect(store.audits.at(-1)?.eventType).toBe("DEMO_DEBTOR_IDENTIFIED");
  });

  it("recovers the same public challenge after reload without changing attempts", async () => {
    const { service, created, identified } = await createAndIdentify();
    const recovered = await service.getPublicIdentityChallenge(
      created.conversation.id,
      created.token,
      "request-reload",
    );
    expect(recovered).toEqual({
      status: "PENDING",
      challenge: identified.challenge,
      attemptsRemaining: 3,
    });
    expect(recovered.challenge).not.toHaveProperty("challengeRef");
    expect(JSON.stringify(recovered)).not.toContain("correctOptionRef");
  });

  it("returns remaining attempts and safe terminal challenge states", async () => {
    const failed = await createAndIdentify();
    await failed.service.verifyIdentity(
      failed.created.conversation.id,
      failed.created.token,
      "option-blue",
      "request-failed-once",
    );
    const pending = await failed.service.getPublicIdentityChallenge(
      failed.created.conversation.id,
      failed.created.token,
      "request-after-failure",
    );
    expect(pending.status).toBe("PENDING");
    expect(pending.attemptsRemaining).toBe(2);
    expect(pending.challenge?.attemptsRemaining).toBe(2);

    await failed.service.verifyIdentity(
      failed.created.conversation.id,
      failed.created.token,
      "option-blue",
      "request-failed-twice",
    );
    await failed.service.verifyIdentity(
      failed.created.conversation.id,
      failed.created.token,
      "option-blue",
      "request-failed-third",
    );
    expect(
      await failed.service.getPublicIdentityChallenge(
        failed.created.conversation.id,
        failed.created.token,
        "request-blocked",
      ),
    ).toEqual({
      status: "BLOCKED",
      challenge: null,
      attemptsRemaining: 0,
    });

    const verified = await createAndIdentify();
    await verified.service.verifyIdentity(
      verified.created.conversation.id,
      verified.created.token,
      "option-green",
      "request-verified",
    );
    expect(
      await verified.service.getPublicIdentityChallenge(
        verified.created.conversation.id,
        verified.created.token,
        "request-after-verified",
      ),
    ).toEqual({
      status: "VERIFIED",
      challenge: null,
      attemptsRemaining: 0,
    });
  });

  it("does not expose another conversation challenge with the wrong cookie", async () => {
    const { service } = setup();
    const first = await service.create("jf-demo");
    const second = await service.create("jf-demo");
    await service.identify(
      second.conversation.id,
      second.token,
      "DEMO-AURORA-001",
      "request-second-identify",
    );
    await expect(
      service.getPublicIdentityChallenge(
        second.conversation.id,
        first.token,
        "request-cross-session",
      ),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("blocks the session after three consecutive failures", async () => {
    const { service, created } = await createAndIdentify();

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const result = await service.verifyIdentity(
        created.conversation.id,
        created.token,
        "option-blue",
        `request-failure-${attempt}`,
      );
      expect(result.verified).toBe(false);
      expect(result.conversation.identityStatus).toBe("PENDING");
    }

    const third = await service.verifyIdentity(
      created.conversation.id,
      created.token,
      "option-blue",
      "request-failure-3",
    );
    expect(third.verified).toBe(false);
    expect(third.conversation.identityStatus).toBe("BLOCKED");
    expect(third.conversation.state).toBe("IDENTITY_BLOCKED");

    await expect(
      service.verifyIdentity(
        created.conversation.id,
        created.token,
        "option-green",
        "request-after-lock",
      ),
    ).rejects.toMatchObject({ code: "IDENTITY_LOCKED", status: 423 });
  });

  it("persists successful simulated validation without revealing debt", async () => {
    const { store, service, created } = await createAndIdentify();
    const result = await service.verifyIdentity(
      created.conversation.id,
      created.token,
      "option-green",
      "request-success",
    );
    const serialized = JSON.stringify(result);

    expect(result.verified).toBe(true);
    expect(result.conversation.identityStatus).toBe("VERIFIED");
    expect(result.conversation.state).toBe("IDENTITY_VERIFIED");
    expect(serialized).not.toContain("debt-001");
    expect(serialized).not.toContain("offer-");
    expect(store.audits.at(-1)?.eventType).toBe("IDENTITY_VERIFIED");
  });

  it("does not list debts before identity verification", async () => {
    const { service } = setup();
    const created = await service.create("jf-demo");

    await expect(
      service.listDebts(
        created.conversation.id,
        created.token,
        "request-debts-before-identity",
      ),
    ).rejects.toMatchObject({
      code: "IDENTITY_VERIFICATION_REQUIRED",
      status: 403,
    });
  });

  it("groups provider debts by creditor without changing values", async () => {
    const { store, service, created } = await createAndIdentify();
    await service.verifyIdentity(
      created.conversation.id,
      created.token,
      "option-green",
      "request-verify-for-debts",
    );

    const result = await service.listDebts(
      created.conversation.id,
      created.token,
      "request-list-debts",
    );

    expect(result.creditors).toHaveLength(2);
    expect(result.creditors.map((creditor) => creditor.creditorRef)).toEqual([
      "creditor-horizonte",
      "creditor-boreal",
    ]);
    expect(result.creditors[0].debts[0]).toEqual({
      debtRef: "debt-001",
      description: "Contrato fictício Horizonte 2026",
      amount: { amountInCents: 48_750, currency: "BRL" },
      dueDate: "2026-06-10",
      status: "OPEN",
    });
    expect(store.audits.at(-1)).toMatchObject({
      eventType: "DEBTS_LISTED",
      metadata: { debtCount: 2 },
    });
  });

  it("returns only provider-authorized offers and marks expiration safely", async () => {
    const { store, service, created } = await createAndIdentify();
    await service.verifyIdentity(
      created.conversation.id,
      created.token,
      "option-green",
      "request-verify-for-offers",
    );

    const result = await service.listAuthorizedOffers(
      created.conversation.id,
      created.token,
      "debt-001",
      "request-list-offers",
    );

    expect(result.offers.map((offer) => offer.offerRef)).toEqual([
      "offer-cash-001",
      "offer-installment-001",
      "offer-expired-001",
    ]);
    expect(result.offers[0]).toMatchObject({
      total: { amountInCents: 39_000, currency: "BRL" },
      installmentCount: 1,
      installmentAmount: { amountInCents: 39_000, currency: "BRL" },
      status: "AVAILABLE",
    });
    expect(result.offers.at(-1)?.status).toBe("EXPIRED");
    expect(JSON.stringify(result)).not.toContain("offer-disabled-001");
    expect(store.audits.at(-1)?.eventType).toBe(
      "AUTHORIZED_OFFERS_LISTED",
    );
  });

  it("keeps overlapping debt references isolated by organization", async () => {
    const { service } = setup();
    const jf = await service.create("jf-demo");
    await service.identify(
      jf.conversation.id,
      jf.token,
      "DEMO-AURORA-001",
      "request-jf-identify",
    );
    await service.verifyIdentity(
      jf.conversation.id,
      jf.token,
      "option-green",
      "request-jf-verify",
    );

    const atlas = await service.create("atlas-demo");
    await service.identify(
      atlas.conversation.id,
      atlas.token,
      "DEMO-BENTO-002",
      "request-atlas-identify",
    );
    await service.verifyIdentity(
      atlas.conversation.id,
      atlas.token,
      "option-star",
      "request-atlas-verify",
    );

    const jfDebt = await service.getDebt(
      jf.conversation.id,
      jf.token,
      "debt-001",
      "request-jf-debt",
    );
    const atlasDebt = await service.getDebt(
      atlas.conversation.id,
      atlas.token,
      "debt-001",
      "request-atlas-debt",
    );

    expect(jfDebt.amount.amountInCents).toBe(48_750);
    expect(atlasDebt.amount.amountInCents).toBe(91_200);
    await expect(
      service.getDebt(
        atlas.conversation.id,
        jf.token,
        "debt-001",
        "request-cross-organization",
      ),
    ).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("prevents negotiation after opt-out", async () => {
    const { store, service } = setup();
    const created = await service.create("jf-demo");
    const current = store.conversations.get(created.conversation.id)!;
    store.conversations.set(created.conversation.id, {
      ...current,
      state: "OPTED_OUT",
      optedOutAt: fixedNow,
    });

    await expect(
      service.identify(
        created.conversation.id,
        created.token,
        "DEMO-AURORA-001",
        "request-opted-out",
      ),
    ).rejects.toMatchObject({ code: "MESSAGING_OPTED_OUT" });
  });

  it("closes before identity, persists one audit, and repeats idempotently", async () => {
    const { store, provider, service } = setup();
    const providerCall = vi.spyOn(provider, "identifyDebtor");
    const created = await service.create("jf-demo");
    const first = await service.close(created.conversation.id, created.token);
    const repeated = await service.close(created.conversation.id, created.token);

    expect(first.state).toBe("CLOSED");
    expect(first.endedAt).toBe(fixedNow.toISOString());
    expect(repeated).toEqual(first);
    expect(store.audits.filter((audit) => audit.eventType === "CONVERSATION_CLOSED")).toHaveLength(1);
    expect(providerCall).not.toHaveBeenCalled();
    await expect(
      service.identify(created.conversation.id, created.token, "DEMO-AURORA-001", "after-close"),
    ).rejects.toMatchObject({ code: "CONVERSATION_CLOSED" });
  });

  it("requires the matching session cookie for terminal commands", async () => {
    const { service } = setup();
    const jf = await service.create("jf-demo");
    const atlas = await service.create("atlas-demo");
    await expect(service.close(jf.conversation.id, undefined)).rejects.toMatchObject({ code: "SESSION_REQUIRED" });
    await expect(service.optOut(jf.conversation.id, atlas.token)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("opts out before identity and keeps OPTED_OUT terminal", async () => {
    const { store, service } = setup();
    const created = await service.create("jf-demo");
    const first = await service.optOut(created.conversation.id, created.token);
    const repeated = await service.optOut(created.conversation.id, created.token);
    const closeAfterOptOut = await service.close(created.conversation.id, created.token);

    expect(first.state).toBe("OPTED_OUT");
    expect(first.optedOutAt).toBe(fixedNow.toISOString());
    expect(repeated).toEqual(first);
    expect(closeAfterOptOut.state).toBe("OPTED_OUT");
    expect(store.audits.filter((audit) => audit.eventType === "CONVERSATION_OPTED_OUT")).toHaveLength(1);
    expect(store.audits.some((audit) => audit.eventType === "CONVERSATION_CLOSED")).toBe(false);
  });

  it("returns one deterministic result for simultaneous repeated opt-out", async () => {
    const { store, service } = setup();
    const created = await service.create("jf-demo");
    const results = await Promise.all([
      service.optOut(created.conversation.id, created.token),
      service.optOut(created.conversation.id, created.token),
    ]);

    expect(results[0]).toEqual(results[1]);
    expect(results[0].state).toBe("OPTED_OUT");
    expect(store.audits.filter((audit) => audit.eventType === "CONVERSATION_OPTED_OUT")).toHaveLength(1);
  });

  it("returns a safe not-found result for an unknown organization", async () => {
    const { service } = setup();

    await expect(service.create("unknown-demo")).rejects.toMatchObject({
      code: "ORGANIZATION_NOT_FOUND",
      status: 404,
    });
  });
});

describe("conversation input schemas", () => {
  it("accepts only demonstration identifiers", () => {
    expect(
      demoIdentifierSchema.parse({ demoIdentifier: "DEMO-AURORA-001" }),
    ).toEqual({ demoIdentifier: "DEMO-AURORA-001" });
    expect(() =>
      demoIdentifierSchema.parse({ demoIdentifier: "123.456.789-00" }),
    ).toThrow();
  });

  it("rejects invalid slugs and verification options", () => {
    expect(() => organizationSlugSchema.parse("../jf-demo")).toThrow();
    expect(() =>
      identityVerificationSchema.parse({ optionRef: "<script>" }),
    ).toThrow();
  });

  it("rejects internal or extra fields in a public challenge", () => {
    expect(() =>
      publicIdentityChallengeSchema.parse({
        prompt: "Pergunta",
        options: [
          { optionRef: "option-a", label: "A" },
          { optionRef: "option-b", label: "B" },
        ],
        attemptsRemaining: 3,
        correctOptionRef: "option-a",
      }),
    ).toThrow();
  });

  it("requires explicit terminal confirmation and rejects extra fields", () => {
    expect(terminalConversationCommandSchema.parse({ confirmation: true })).toEqual({ confirmation: true });
    expect(() => terminalConversationCommandSchema.parse({ confirmation: false })).toThrow();
    expect(() => terminalConversationCommandSchema.parse({ confirmation: true, state: "CLOSED" })).toThrow();
  });
});
