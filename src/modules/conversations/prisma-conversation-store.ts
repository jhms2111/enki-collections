import type { Prisma, PrismaClient } from "@/generated/prisma/client";

import type { ConversationStore } from "./conversation-store";
import type { VerifiedDebtorContext } from "@/modules/debt-provider/debt-provider.types";
import { parseAuditMetadata } from "./audit-metadata";
import type {
  AuditInput,
  PersistedConversation,
  PersistedOrganization,
} from "./persistence.types";

type PrismaTransaction = Parameters<
  Parameters<PrismaClient["$transaction"]>[0]
>[0];

const conversationInclude = {
  organization: {
    select: {
      externalRef: true,
      timeZone: true,
    },
  },
  messages: {
    orderBy: {
      createdAt: "asc",
    },
    select: {
      direction: true,
      actor: true,
      content: true,
      intent: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ConversationInclude;

type ConversationWithPublicData = Prisma.ConversationGetPayload<{
  include: typeof conversationInclude;
}>;

export class PrismaConversationStore implements ConversationStore {
  constructor(private readonly client: PrismaClient) {}

  async findActiveOrganizationBySlug(
    slug: string,
  ): Promise<PersistedOrganization | null> {
    return this.client.organization.findFirst({
      where: {
        slug,
        status: "ACTIVE",
      },
      select: {
        id: true,
        slug: true,
        externalRef: true,
        name: true,
        status: true,
      },
    });
  }

  async createConversation(input: {
    organization: PersistedOrganization;
    publicReference: string;
    sessionTokenHash: string;
    now: Date;
    welcomeMessage: string;
    audit: AuditInput;
  }): Promise<PersistedConversation> {
    const createdId = await this.client.$transaction(async (transaction) => {
      const conversation = await transaction.conversation.create({
        data: {
          organizationId: input.organization.id,
          publicReference: input.publicReference,
          sessionTokenHash: input.sessionTokenHash,
          startedAt: input.now,
          lastActivityAt: input.now,
        },
        select: { id: true },
      });

      await transaction.message.create({
        data: {
          organizationId: input.organization.id,
          conversationId: conversation.id,
          direction: "OUTBOUND",
          actor: "SYSTEM",
          content: input.welcomeMessage,
          createdAt: input.now,
        },
      });
      await this.createAudit(transaction, {
        organizationId: input.organization.id,
        conversationId: conversation.id,
        audit: input.audit,
      });

      return conversation.id;
    });

    return this.requireConversation(createdId, input.organization.id);
  }

  async authenticateConversation(
    publicReference: string,
    sessionTokenHash: string,
    startedAfter: Date,
  ): Promise<PersistedConversation | null> {
    const conversation = await this.client.conversation.findFirst({
      where: {
        publicReference,
        sessionTokenHash,
        startedAt: {
          gte: startedAfter,
        },
        endedAt: null,
        organization: {
          status: "ACTIVE",
        },
      },
      include: conversationInclude,
    });

    return conversation ? this.mapConversation(conversation) : null;
  }

  async recordIdentification(input: {
    conversation: PersistedConversation;
    identificationRef: string;
    now: Date;
    audit: AuditInput;
  }): Promise<PersistedConversation> {
    await this.client.$transaction(async (transaction) => {
      await transaction.conversation.update({
        where: {
          id_organizationId: {
            id: input.conversation.id,
            organizationId: input.conversation.organizationId,
          },
        },
        data: {
          debtorRef: input.identificationRef,
          identityStatus: "PENDING",
          state: "IDENTIFIED",
          lastActivityAt: input.now,
        },
      });
      await this.createAudit(transaction, {
        organizationId: input.conversation.organizationId,
        conversationId: input.conversation.id,
        audit: input.audit,
      });
    });

    return this.requireConversation(
      input.conversation.id,
      input.conversation.organizationId,
    );
  }

  async recordIdentityAttempt(input: {
    conversation: PersistedConversation;
    verified: boolean;
    verifiedDebtorRef?: string;
    verifiedDebtorContext?: VerifiedDebtorContext;
    maxAttempts: number;
    now: Date;
    audit: AuditInput;
  }): Promise<PersistedConversation> {
    await this.client.$transaction(async (transaction) => {
      const current = await transaction.conversation.findUniqueOrThrow({
        where: {
          id_organizationId: {
            id: input.conversation.id,
            organizationId: input.conversation.organizationId,
          },
        },
        select: {
          failedIdentityAttempts: true,
          identityStatus: true,
        },
      });

      if (current.identityStatus === "BLOCKED") {
        return;
      }

      let failedAttempts = current.failedIdentityAttempts;
      let blocked = false;

      if (input.verified) {
        await transaction.conversation.update({
          where: {
            id_organizationId: {
              id: input.conversation.id,
              organizationId: input.conversation.organizationId,
            },
          },
          data: {
              debtorRef: input.verifiedDebtorRef,
              verifiedDebtorContext:
                input.verifiedDebtorContext as Prisma.InputJsonValue,
              identityStatus: "VERIFIED",
              state: "IDENTITY_VERIFIED",
              lastActivityAt: input.now,
          },
        });
      } else {
        const failed = await transaction.conversation.update({
          where: {
            id_organizationId: {
              id: input.conversation.id,
              organizationId: input.conversation.organizationId,
            },
          },
          data: {
            failedIdentityAttempts: { increment: 1 },
            lastActivityAt: input.now,
          },
          select: {
            failedIdentityAttempts: true,
          },
        });
        failedAttempts = failed.failedIdentityAttempts;
        blocked = failedAttempts >= input.maxAttempts;

        await transaction.conversation.update({
          where: {
            id_organizationId: {
              id: input.conversation.id,
              organizationId: input.conversation.organizationId,
            },
          },
          data: {
              identityStatus: blocked ? "BLOCKED" : "PENDING",
              state: blocked ? "IDENTITY_BLOCKED" : "IDENTIFIED",
              identityLockedAt: blocked ? input.now : null,
          },
        });
      }

      await this.createAudit(transaction, {
        organizationId: input.conversation.organizationId,
        conversationId: input.conversation.id,
        audit: {
          ...input.audit,
          metadata: {
            ...input.audit.metadata,
            failedAttempts,
            blocked,
          },
        },
      });
    });

    return this.requireConversation(
      input.conversation.id,
      input.conversation.organizationId,
    );
  }

  async recordAudit(input: {
    conversation: PersistedConversation;
    audit: AuditInput;
  }): Promise<void> {
    await this.createAudit(this.client, {
      organizationId: input.conversation.organizationId,
      conversationId: input.conversation.id,
      audit: input.audit,
    });
  }

  private async requireConversation(
    id: string,
    organizationId: string,
  ): Promise<PersistedConversation> {
    const conversation = await this.client.conversation.findUniqueOrThrow({
      where: {
        id_organizationId: {
          id,
          organizationId,
        },
      },
      include: conversationInclude,
    });

    return this.mapConversation(conversation);
  }

  private async createAudit(
    transaction: PrismaTransaction,
    input: {
      organizationId: string;
      conversationId: string;
      audit: AuditInput;
    },
  ): Promise<void> {
    const metadata = parseAuditMetadata(input.audit.metadata);

    await transaction.auditEvent.create({
      data: {
        organizationId: input.organizationId,
        conversationId: input.conversationId,
        eventType: input.audit.eventType,
        actor: input.audit.actor,
        entityType: input.audit.entityType,
        entityRef: input.audit.entityRef,
        metadata,
        occurredAt: input.audit.occurredAt,
      },
    });
  }

  private mapConversation(
    conversation: ConversationWithPublicData,
  ): PersistedConversation {
    return {
      id: conversation.id,
      organizationId: conversation.organizationId,
      organizationExternalRef: conversation.organization.externalRef,
      organizationTimeZone: conversation.organization.timeZone,
      publicReference: conversation.publicReference,
      state: conversation.state,
      debtorRef: conversation.debtorRef,
      verifiedDebtorContext: conversation.verifiedDebtorContext,
      identityStatus: conversation.identityStatus,
      failedIdentityAttempts: conversation.failedIdentityAttempts,
      identityLockedAt: conversation.identityLockedAt,
      startedAt: conversation.startedAt,
      lastActivityAt: conversation.lastActivityAt,
      endedAt: conversation.endedAt,
      optedOutAt: conversation.optedOutAt,
      messages: conversation.messages,
    };
  }
}
