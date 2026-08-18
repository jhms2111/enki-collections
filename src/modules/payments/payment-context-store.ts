import type { PersistedOfferAcceptance } from "@/modules/conversations/acceptance-store";
import type { PersistedConversation } from "@/modules/conversations/persistence.types";

export interface PaymentContextStore {
  authenticateBySession(
    sessionTokenHash: string,
    startedAfter: Date,
  ): Promise<Readonly<{ conversation: PersistedConversation; organizationSlug: string }> | null>;
  findLatestAcceptance(
    conversation: PersistedConversation,
  ): Promise<PersistedOfferAcceptance | null>;
}
