import { createHash, createHmac } from "node:crypto";

import { ApplicationError } from "@/shared/errors/application-error";

export const idempotentOperations = [
  "ACCEPT_OFFER",
  "CREATE_PAYMENT_INSTRUMENT",
  "REGISTER_PAYMENT_PROMISE",
  "REPORT_PAYMENT",
  "OPEN_DISPUTE",
  "REQUEST_HUMAN_HANDOFF",
] as const;

export type IdempotentOperation = (typeof idempotentOperations)[number];

export function assertIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,127}$/.test(key)) {
    throw new ApplicationError(
      "INVALID_IDEMPOTENCY_KEY",
      "A chave de idempotência é inválida.",
      400,
    );
  }
}

export function hashIdempotencyKey(
  key: string,
  secret: string,
): string {
  assertIdempotencyKey(key);
  return createHmac("sha256", secret).update(key).digest("hex");
}

export function deriveProviderIdempotencyKey(input: {
  organizationId: string;
  operation: IdempotentOperation;
  resourceRef: string;
  keyHash: string;
  secret: string;
}): string {
  const derived = createHmac("sha256", input.secret)
    .update(
      `${input.organizationId}:${input.operation}:${input.resourceRef}:${input.keyHash}`,
    )
    .digest("hex");
  return `idem:${derived}`;
}

export function fingerprintPayload(payload: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}
