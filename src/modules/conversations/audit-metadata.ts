import { z } from "zod";

import { ApplicationError } from "@/shared/errors/application-error";

const auditScalar = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

const auditMetadataSchema = z.record(z.string().max(80), auditScalar);

export function parseAuditMetadata(
  value: unknown,
): Readonly<Record<string, string | number | boolean | null>> {
  const parsed = auditMetadataSchema.parse(value);

  if (Buffer.byteLength(JSON.stringify(parsed), "utf8") > 4_096) {
    throw new ApplicationError(
      "AUDIT_METADATA_TOO_LARGE",
      "Os metadados de auditoria excedem o limite.",
      400,
    );
  }

  return parsed;
}
