import { describe, expect, it } from "vitest";
import { createInternalSessionToken, decodeInternalAttempts, encodeInternalAttempts, hashInternalAccessCode, hashInternalSessionToken, verifyInternalAccessCode } from "@/shared/auth/internal-access";

describe("internal access", () => {
  const secret = "i".repeat(64);
  it("usa domínio e segredo próprios", () => { const hash = hashInternalAccessCode("codigo-interno", secret); expect(hash).toHaveLength(64); expect(verifyInternalAccessCode("codigo-interno", hash, secret)).toBe(true); expect(verifyInternalAccessCode("outro-codigo", hash, secret)).toBe(false); });
  it("armazena somente hash do token forte", () => { const token = createInternalSessionToken(); expect(token.length).toBeGreaterThanOrEqual(64); expect(hashInternalSessionToken(token)).toHaveLength(64); expect(hashInternalSessionToken(token)).not.toContain(token); });
  it("assina e expira o contador de tentativas", () => { const value = encodeInternalAttempts({ failedAttempts: 2, expiresAt: 2_000 }, secret); expect(decodeInternalAttempts(value, secret, new Date(1_000))).toEqual({ failedAttempts: 2, expiresAt: 2_000 }); expect(decodeInternalAttempts(value, secret, new Date(3_000))).toBeNull(); expect(decodeInternalAttempts(`${value}x`, secret, new Date(1_000))).toBeNull(); });
});
