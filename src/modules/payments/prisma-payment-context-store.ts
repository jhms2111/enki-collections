import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { offerTermsSchema } from "@/modules/conversations/acceptance.schemas";
import type { PersistedOfferAcceptance } from "@/modules/conversations/acceptance-store";
import type { PersistedConversation } from "@/modules/conversations/persistence.types";

import type { PaymentContextStore } from "./payment-context-store";

const include = {
  organization: { select: { externalRef: true, timeZone: true, slug: true } },
  messages: { orderBy: { createdAt: "asc" }, select: { direction: true, actor: true, content: true, intent: true, createdAt: true } },
} satisfies Prisma.ConversationInclude;

export class PrismaPaymentContextStore implements PaymentContextStore {
  constructor(private readonly client: PrismaClient) {}

  async authenticateBySession(sessionTokenHash: string, startedAfter: Date): Promise<Readonly<{ conversation: PersistedConversation; organizationSlug: string }> | null> {
    const row = await this.client.conversation.findFirst({
      where: { sessionTokenHash, startedAt: { gte: startedAfter }, organization: { status: "ACTIVE" } },
      include,
      orderBy: { startedAt: "desc" },
    });
    if (!row) return null;
    return { organizationSlug: row.organization.slug, conversation: {
      id: row.id, organizationId: row.organizationId, organizationExternalRef: row.organization.externalRef,
      organizationTimeZone: row.organization.timeZone, publicReference: row.publicReference, state: row.state,
      debtorRef: row.debtorRef, verifiedDebtorContext: row.verifiedDebtorContext, identityStatus: row.identityStatus,
      failedIdentityAttempts: row.failedIdentityAttempts, identityLockedAt: row.identityLockedAt,
      startedAt: row.startedAt, lastActivityAt: row.lastActivityAt, endedAt: row.endedAt,
      optedOutAt: row.optedOutAt, messages: row.messages,
    } };
  }

  async findLatestAcceptance(conversation: PersistedConversation): Promise<PersistedOfferAcceptance | null> {
    const row = await this.client.offerAcceptance.findFirst({
      where: { organizationId: conversation.organizationId, conversationId: conversation.id },
      orderBy: { acceptedAt: "desc" },
    });
    return row ? {
      id: row.id, organizationId: row.organizationId, conversationId: row.conversationId,
      publicReference: row.publicReference, debtRef: row.debtRef, offerRef: row.offerRef,
      providerAcceptanceRef: row.providerAcceptanceRef, providerVersion: row.providerVersion,
      termsSnapshot: offerTermsSchema.parse(row.termsSnapshot), acceptedAt: row.acceptedAt,
    } : null;
  }
}
