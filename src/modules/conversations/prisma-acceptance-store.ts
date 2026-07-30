import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { ApplicationError } from "@/shared/errors/application-error";

import {
  acceptanceResponseSchema,
  instrumentResponseSchema,
  offerTermsSchema,
  type AcceptanceResponse,
  type InstrumentResponse,
} from "./acceptance.schemas";
import type {
  AcceptanceStore,
  IdempotencyScope,
  PersistedOfferAcceptance,
} from "./acceptance-store";
import { parseAuditMetadata } from "./audit-metadata";
import type { AuditInput, PersistedConversation } from "./persistence.types";

export class PrismaAcceptanceStore implements AcceptanceStore {
  constructor(private readonly client: PrismaClient) {}

  async findAcceptanceResult(
    scope: IdempotencyScope,
  ): Promise<AcceptanceResponse | null> {
    const payload = await this.findIdempotentPayload(scope);
    return payload ? acceptanceResponseSchema.parse(payload) : null;
  }

  async finalizeAcceptance(input: {
    scope: IdempotencyScope;
    conversation: PersistedConversation;
    acceptance: PersistedOfferAcceptance;
    response: AcceptanceResponse;
    audit: AuditInput;
  }): Promise<AcceptanceResponse> {
    try {
      return await this.client.$transaction(
        async (transaction) => {
          const existing = await this.findIdempotentPayload(
            input.scope,
            transaction,
          );
          if (existing) {
            return acceptanceResponseSchema.parse(existing);
          }

          await transaction.offerAcceptance.create({
            data: {
              id: input.acceptance.id,
              organizationId: input.conversation.organizationId,
              conversationId: input.conversation.id,
              publicReference: input.acceptance.publicReference,
              debtRef: input.acceptance.debtRef,
              offerRef: input.acceptance.offerRef,
              providerAcceptanceRef:
                input.acceptance.providerAcceptanceRef,
              providerVersion: input.acceptance.providerVersion,
              termsSnapshot:
                input.acceptance.termsSnapshot as Prisma.InputJsonValue,
              idempotencyKeyHash: input.scope.keyHash,
              acceptedAt: input.acceptance.acceptedAt,
            },
          });
          await transaction.idempotencyRecord.create({
            data: {
              organizationId: input.scope.organizationId,
              operation: input.scope.operation,
              resourceRef: input.scope.resourceRef,
              idempotencyKeyHash: input.scope.keyHash,
              requestFingerprint: input.scope.requestFingerprint,
              responsePayload:
                input.response as unknown as Prisma.InputJsonValue,
            },
          });
          await this.createAudit(
            transaction,
            input.conversation,
            input.audit,
          );
          await transaction.conversation.update({
            where: {
              id_organizationId: {
                id: input.conversation.id,
                organizationId: input.conversation.organizationId,
              },
            },
            data: {
              state: "OFFER_ACCEPTED",
              lastActivityAt: input.acceptance.acceptedAt,
            },
          });

          return input.response;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      const reconciled = await this.findAcceptanceResult(input.scope);
      if (reconciled) {
        return reconciled;
      }
      throw error;
    }
  }

  async findAcceptance(
    conversation: PersistedConversation,
    publicReference: string,
  ): Promise<PersistedOfferAcceptance | null> {
    const acceptance = await this.client.offerAcceptance.findFirst({
      where: {
        publicReference,
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
      },
    });
    if (!acceptance) {
      return null;
    }

    return {
      id: acceptance.id,
      organizationId: acceptance.organizationId,
      conversationId: acceptance.conversationId,
      publicReference: acceptance.publicReference,
      debtRef: acceptance.debtRef,
      offerRef: acceptance.offerRef,
      providerAcceptanceRef: acceptance.providerAcceptanceRef,
      providerVersion: acceptance.providerVersion,
      termsSnapshot: offerTermsSchema.parse(acceptance.termsSnapshot),
      acceptedAt: acceptance.acceptedAt,
    };
  }

  async findInstrumentResult(
    scope: IdempotencyScope,
  ): Promise<InstrumentResponse | null> {
    const payload = await this.findIdempotentPayload(scope);
    return payload ? instrumentResponseSchema.parse(payload) : null;
  }

  async finalizeInstrument(input: {
    scope: IdempotencyScope;
    conversation: PersistedConversation;
    response: InstrumentResponse;
    audit: AuditInput;
    expiresAt: Date;
  }): Promise<InstrumentResponse> {
    try {
      return await this.client.$transaction(
        async (transaction) => {
          const existing = await this.findIdempotentPayload(
            input.scope,
            transaction,
          );
          if (existing) {
            return instrumentResponseSchema.parse(existing);
          }

          await transaction.idempotencyRecord.create({
            data: {
              organizationId: input.scope.organizationId,
              operation: input.scope.operation,
              resourceRef: input.scope.resourceRef,
              idempotencyKeyHash: input.scope.keyHash,
              requestFingerprint: input.scope.requestFingerprint,
              responsePayload:
                input.response as unknown as Prisma.InputJsonValue,
              expiresAt: input.expiresAt,
            },
          });
          await this.createAudit(
            transaction,
            input.conversation,
            input.audit,
          );

          return input.response;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      const reconciled = await this.findInstrumentResult(input.scope);
      if (reconciled) {
        return reconciled;
      }
      throw error;
    }
  }

  private async findIdempotentPayload(
    scope: IdempotencyScope,
    client: PrismaClient | Prisma.TransactionClient = this.client,
  ): Promise<Prisma.JsonValue | null> {
    const record = await client.idempotencyRecord.findUnique({
      where: {
        organizationId_operation_resourceRef_idempotencyKeyHash: {
          organizationId: scope.organizationId,
          operation: scope.operation,
          resourceRef: scope.resourceRef,
          idempotencyKeyHash: scope.keyHash,
        },
      },
      select: {
        requestFingerprint: true,
        responsePayload: true,
      },
    });
    if (!record) {
      return null;
    }
    if (record.requestFingerprint !== scope.requestFingerprint) {
      throw new ApplicationError(
        "IDEMPOTENCY_CONFLICT",
        "A chave de idempotência já foi usada com outro conteúdo.",
        409,
      );
    }
    return record.responsePayload;
  }

  private async createAudit(
    transaction: Prisma.TransactionClient,
    conversation: PersistedConversation,
    audit: AuditInput,
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        organizationId: conversation.organizationId,
        conversationId: conversation.id,
        eventType: audit.eventType,
        actor: audit.actor,
        entityType: audit.entityType,
        entityRef: audit.entityRef,
        metadata: parseAuditMetadata(audit.metadata),
        occurredAt: audit.occurredAt,
      },
    });
  }
}
