import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { createInternalSessionToken, decodeInternalAttempts, encodeInternalAttempts, hashInternalAccessCode, hashInternalSessionToken, verifyInternalAccessCode } from "@/shared/auth/internal-access";
import { createInternalAccessCredentials, readInternalAccessCodeFromStdin } from "@/shared/auth/internal-access-provisioning";

describe("internal access", () => {
  const secret = "i".repeat(64);
  it("usa domínio e segredo próprios", () => { const hash = hashInternalAccessCode("codigo-interno", secret); expect(hash).toHaveLength(64); expect(verifyInternalAccessCode("codigo-interno", hash, secret)).toBe(true); expect(verifyInternalAccessCode("outro-codigo", hash, secret)).toBe(false); });
  it("armazena somente hash do token forte", () => { const token = createInternalSessionToken(); expect(token.length).toBeGreaterThanOrEqual(64); expect(hashInternalSessionToken(token)).toHaveLength(64); expect(hashInternalSessionToken(token)).not.toContain(token); });
  it("assina e expira o contador de tentativas", () => { const value = encodeInternalAttempts({ failedAttempts: 2, expiresAt: 2_000 }, secret); expect(decodeInternalAttempts(value, secret, new Date(1_000))).toEqual({ failedAttempts: 2, expiresAt: 2_000 }); expect(decodeInternalAttempts(value, secret, new Date(3_000))).toBeNull(); expect(decodeInternalAttempts(`${value}x`, secret, new Date(1_000))).toBeNull(); });
  it("mantem paridade exata entre provisionador e validador", () => {
    const fictitiousSecret = "sandbox-secret-ficticio-para-paridade-interna-2026-abcdefghijklmnop";
    const fictitiousCode = "DEMO-Codigo-Ç-2026";
    const credentials = createInternalAccessCredentials(fictitiousCode, fictitiousSecret);

    expect(credentials).toEqual({
      secret: fictitiousSecret,
      codeHash: "67e3ed0f764881844ab203f9bd1232f4e22de139cc30d3770920dfc1a0f52339",
    });
    expect(credentials.codeHash).toBe(hashInternalAccessCode(fictitiousCode, fictitiousSecret));
    expect(credentials.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyInternalAccessCode(fictitiousCode, credentials.codeHash, credentials.secret)).toBe(true);
    expect(verifyInternalAccessCode(fictitiousCode.normalize("NFD"), credentials.codeHash, credentials.secret)).toBe(false);
  });
  it("recebe codigo ficticio por stdin e remove somente a quebra de transporte", async () => {
    const fictitiousCode = " DEMO-Codigo-Ç-2026 ";
    await expect(readInternalAccessCodeFromStdin(Readable.from([Buffer.from(`${fictitiousCode}\r\n`, "utf8")]))).resolves.toBe(fictitiousCode);
    await expect(readInternalAccessCodeFromStdin(Readable.from([Buffer.from("DEMO-Linha-1\nLinha-2\n", "utf8")]))).resolves.toBe("DEMO-Linha-1\nLinha-2");
    await expect(readInternalAccessCodeFromStdin(Readable.from([Buffer.from("DEMO-sem-transporte", "utf8")]))).rejects.toThrow(/transporte/);
  });
});
