import { randomBytes } from "node:crypto";
import type { Readable } from "node:stream";

import { hashInternalAccessCode, verifyInternalAccessCode } from "@/shared/auth/internal-access";

export type InternalAccessCredentials = Readonly<{
  secret: string;
  codeHash: string;
}>;

export async function readInternalAccessCodeFromStdin(input: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of input) {
      chunks.push(Buffer.isBuffer(chunk) ? Buffer.from(chunk) : Buffer.from(String(chunk), "utf8"));
    }
    const bytes = Buffer.concat(chunks);
    try {
      const transported = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      if (transported.endsWith("\r\n")) return transported.slice(0, -2);
      if (transported.endsWith("\n")) return transported.slice(0, -1);
      throw new Error("A entrada segura nao terminou com a quebra de linha de transporte.");
    } finally {
      bytes.fill(0);
    }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
  }
}

export function createInternalAccessCredentials(
  code: string,
  secret = randomBytes(48).toString("base64url"),
): InternalAccessCredentials {
  if (code.length < 8 || code.length > 128) {
    throw new Error("O codigo interno deve ter entre 8 e 128 caracteres.");
  }
  if (secret.length < 64) {
    throw new Error("O segredo HMAC deve ter pelo menos 64 caracteres.");
  }

  const codeHash = hashInternalAccessCode(code, secret);
  if (!verifyInternalAccessCode(code, codeHash, secret)) {
    throw new Error("A verificacao de paridade das credenciais internas falhou.");
  }
  return { secret, codeHash };
}
