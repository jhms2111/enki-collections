import type { ConversationState } from "@/modules/conversations/conversation-state";
import type { DeterministicIntent } from "@/modules/conversations/intent";
import type { OrganizationContext } from "@/modules/organizations/organization-context";
import type { IdempotentOperation } from "@/shared/idempotency/idempotency";

export type SessionRecord = Readonly<{
  id: string;
  organizationId: string;
  tokenDigest: string;
  state: ConversationState;
  createdAt: Date;
  blockedAt?: Date;
}>;

export interface SessionRepository {
  create(
    organization: OrganizationContext,
    session: SessionRecord,
  ): Promise<void>;
  findByTokenDigest(
    organization: OrganizationContext,
    tokenDigest: string,
  ): Promise<SessionRecord | null>;
  updateState(
    organization: OrganizationContext,
    sessionId: string,
    state: ConversationState,
  ): Promise<void>;
}

export type ConversationRecord = Readonly<{
  id: string;
  organizationId: string;
  sessionId: string;
  channel: "WEBCHAT";
  createdAt: Date;
}>;

export interface ConversationRepository {
  create(
    organization: OrganizationContext,
    conversation: ConversationRecord,
  ): Promise<void>;
  findForAuthenticatedSession(
    organization: OrganizationContext,
    conversationId: string,
    sessionId: string,
  ): Promise<ConversationRecord | null>;
}

export interface MessageRepository {
  append(
    organization: OrganizationContext,
    message: Readonly<{
      id: string;
      conversationId: string;
      direction: "INBOUND" | "OUTBOUND";
      content: string;
      intent?: DeterministicIntent;
      createdAt: Date;
    }>,
  ): Promise<void>;
}

export interface AcceptanceRepository {
  record(
    organization: OrganizationContext,
    acceptance: Readonly<{
      id: string;
      conversationId: string;
      providerAcceptanceRef: string;
      offerRef: string;
      providerVersion: string;
      acceptedAt: Date;
    }>,
  ): Promise<void>;
}

export interface PaymentPromiseRepository {
  recordReference(
    organization: OrganizationContext,
    reference: Readonly<{
      id: string;
      conversationId: string;
      providerReference: string;
      createdAt: Date;
    }>,
  ): Promise<void>;
}

export interface DisputeRepository {
  recordReference(
    organization: OrganizationContext,
    reference: Readonly<{
      id: string;
      conversationId: string;
      providerReference: string;
      createdAt: Date;
    }>,
  ): Promise<void>;
}

export interface HumanHandoffRepository {
  request(
    organization: OrganizationContext,
    input: Readonly<{
      id: string;
      conversationId: string;
      reason: string;
      idempotencyKeyHash: string;
      requestedAt: Date;
    }>,
  ): Promise<void>;
}

export interface CommunicationPreferenceRepository {
  optOut(
    organization: OrganizationContext,
    input: Readonly<{
      sessionId: string;
      channel: "WEBCHAT";
      changedAt: Date;
    }>,
  ): Promise<void>;
}

export interface AuditRepository {
  append(
    organization: OrganizationContext,
    event: Readonly<{
      id: string;
      conversationId: string;
      type: string;
      metadata: Readonly<Record<string, unknown>>;
      occurredAt: Date;
    }>,
  ): Promise<void>;
}

export interface IdempotencyRepository {
  find<Result>(
    organization: OrganizationContext,
    operation: IdempotentOperation,
    resourceRef: string,
    keyHash: string,
  ): Promise<Readonly<{ payloadDigest: string; result: Result }> | null>;
  save<Result>(
    organization: OrganizationContext,
    operation: IdempotentOperation,
    resourceRef: string,
    keyHash: string,
    payloadDigest: string,
    result: Result,
  ): Promise<void>;
}
