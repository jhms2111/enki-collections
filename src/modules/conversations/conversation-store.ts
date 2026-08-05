import type {
  AuditInput,
  PersistedConversation,
  PersistedOrganization,
} from "./persistence.types";
import type { VerifiedDebtorContext } from "@/modules/debt-provider/debt-provider.types";

export interface ConversationStore {
  findActiveOrganizationBySlug(
    slug: string,
  ): Promise<PersistedOrganization | null>;

  createConversation(input: {
    organization: PersistedOrganization;
    publicReference: string;
    sessionTokenHash: string;
    now: Date;
    welcomeMessage: string;
    audit: AuditInput;
  }): Promise<PersistedConversation>;

  authenticateConversation(
    publicReference: string,
    sessionTokenHash: string,
    startedAfter: Date,
  ): Promise<PersistedConversation | null>;

  recordIdentification(input: {
    conversation: PersistedConversation;
    identificationRef: string;
    now: Date;
    audit: AuditInput;
  }): Promise<PersistedConversation>;

  recordIdentityAttempt(input: {
    conversation: PersistedConversation;
    verified: boolean;
    verifiedDebtorRef?: string;
    verifiedDebtorContext?: VerifiedDebtorContext;
    maxAttempts: number;
    now: Date;
    audit: AuditInput;
  }): Promise<PersistedConversation>;

  recordAudit(input: {
    conversation: PersistedConversation;
    audit: AuditInput;
  }): Promise<void>;

  recordTerminalState(input: {
    conversation: PersistedConversation;
    state: "CLOSED" | "OPTED_OUT";
    now: Date;
    audit: AuditInput;
  }): Promise<PersistedConversation>;
}
