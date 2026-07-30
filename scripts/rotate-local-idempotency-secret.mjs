import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
const key = "IDEMPOTENCY_HMAC_SECRET";
const secret = randomBytes(48).toString("base64url");
const current = await readFile(envPath, "utf8");
const line = `${key}=${secret}`;
const pattern = new RegExp(`^${key}=.*$`, "m");
const updated = pattern.test(current)
  ? current.replace(pattern, line)
  : `${current.trimEnd()}\n${line}\n`;

await writeFile(envPath, updated, { encoding: "utf8", mode: 0o600 });
process.stdout.write("Segredo local dedicado de idempotência atualizado.\n");
