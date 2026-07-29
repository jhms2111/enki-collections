import { describe, expect, it } from "vitest";

import { assertIdempotencyKey } from "@/shared/idempotency/idempotency";

describe("assertIdempotencyKey", () => {
  it("accepts a caller-stable opaque key", () => {
    expect(() =>
      assertIdempotencyKey("accept:session-001:request-001"),
    ).not.toThrow();
  });

  it("rejects short keys", () => {
    expect(() => assertIdempotencyKey("short")).toThrowError(
      /chave de idempotência é inválida/,
    );
  });
});

