export type PersistedOrganization = Readonly<{
  id: string;
  slug: string;
  externalRef: string;
  name: string;
  status: "ACTIVE" | "PAUSED" | "DISABLED";
}>;

export type PersistedMessage = Readonly<{
  direction: "INBOUND" | "OUTBOUND";
  actor: "DEBTOR" | "SYSTEM" | "HUMAN_AGENT";
  content: string;
  intent: string | null;
  createdAt: Date;
}>;

export type PersistedConversation = Readonly<{
  id: string;
  organizationId: string;
  organizationExternalRef: string;
  organizationTimeZone: string;
  organizationSlug?: string;
  publicReference: string;
  state:
    | "STARTED"
    | "IDENTIFIED"
    | "IDENTITY_VERIFIED"
    | "DEBT_SELECTED"
    | "OFFER_SELECTED"
    | "OFFER_ACCEPTED"
    | "HUMAN_HANDOFF"
    | "OPTED_OUT"
    | "IDENTITY_BLOCKED"
    | "CLOSED";
  debtorRef: string | null;
  verifiedDebtorContext: unknown | null;
  identityStatus: "NOT_STARTED" | "PENDING" | "VERIFIED" | "BLOCKED";
  failedIdentityAttempts: number;
  identityLockedAt: Date | null;
  startedAt: Date;
  lastActivityAt: Date;
  endedAt: Date | null;
  optedOutAt: Date | null;
  messages: readonly PersistedMessage[];
}>;

export type AuditInput = Readonly<{
  eventType: string;
  actor: "DEBTOR" | "SYSTEM" | "HUMAN_AGENT";
  entityType?: string;
  entityRef?: string;
  metadata: Readonly<Record<string, string | number | boolean | null>>;
  occurredAt: Date;
}>;
