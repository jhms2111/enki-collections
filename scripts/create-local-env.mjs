import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");

if (existsSync(envPath)) {
  throw new Error(".env já existe; nenhum valor foi sobrescrito.");
}

const sessionSecret = randomBytes(48).toString("base64url");
const contents = [
  "DATABASE_URL=",
  "DIRECT_URL=",
  `CONVERSATION_SESSION_SECRET=${sessionSecret}`,
  "APP_URL=http://localhost:3000",
  "NODE_ENV=development",
  "",
].join("\n");

writeFileSync(envPath, contents, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
