import { describe, expect, it } from "vitest";

import type { ConversationStore } from "@/modules/conversations/conversation-store";
import { ConversationService } from "@/modules/conversations/conversation-service";
import {
  demoIdentifierSchema,
  identityVerificationSchema,
  organizationSlugSchema,
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
      publicReference: input.publicReference,
      sessionTokenHash: input.sessionTokenHash,
      state: "STARTED" as const,
      debtorRef: null,
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
      conversation.startedAt >= startedAfter &&
      !conversation.endedAt
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
  return { store, service };
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

  it("identifies only a fictional identifier without exposing challenge or debt", async () => {
    const { store, identified } = await createAndIdentify();
    const serialized = JSON.stringify(identified);

    expect(identified.verificationRequired).toBe(true);
    expect(identified.conversation.identityStatus).toBe("PENDING");
    expect(serialized).not.toContain("challenge");
    expect(serialized).not.toContain("correctOptionRef");
    expect(serialized).not.toContain("debt-");
    expect(serialized).not.toContain("amountInCents");
    expect(store.audits.at(-1)?.eventType).toBe("DEMO_DEBTOR_IDENTIFIED");
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
});
