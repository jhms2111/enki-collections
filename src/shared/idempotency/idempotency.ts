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

