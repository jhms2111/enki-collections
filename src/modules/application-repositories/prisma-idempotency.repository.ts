import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { OrganizationContext } from "@/modules/organizations/organization-context";
import { assertOrganizationContext } from "@/modules/organizations/organization-context";
import type { IdempotencyRepository } from "@/modules/application-repositories/contracts";
import type { IdempotentOperation } from "@/shared/idempotency/idempotency";

export class PrismaIdempotencyRepository
  implements IdempotencyRepository
{
  constructor(private readonly client: PrismaClient) {}

  async find<Result>(
    organization: OrganizationContext,
    operation: IdempotentOperation,
    key: string,
  ): Promise<Readonly<{ payloadDigest: string; result: Result }> | null> {
    assertOrganizationContext(organization);
    const record = await this.client.idempotencyRecord.findUnique({
      where: {
        organizationId_operation_idempotencyKey: {
          organizationId: organization.organizationId,
          operation,
          idempotencyKey: key,
        },
      },
      select: {
        requestFingerprint: true,
        responsePayload: true,
      },
    });

    return record
      ? {
          payloadDigest: record.requestFingerprint,
          result: record.responsePayload as Result,
        }
      : null;
  }

  async save<Result>(
    organization: OrganizationContext,
    operation: IdempotentOperation,
    key: string,
    payloadDigest: string,
    result: Result,
  ): Promise<void> {
    assertOrganizationContext(organization);
    await this.client.idempotencyRecord.create({
      data: {
        organizationId: organization.organizationId,
        operation,
        idempotencyKey: key,
        requestFingerprint: payloadDigest,
        responsePayload: result as Prisma.InputJsonValue,
      },
    });
  }
}
