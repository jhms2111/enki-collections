import { randomBytes } from "node:crypto";
import {
  chmodSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
const temporaryPath = `${envPath}.tmp`;
const contents = readFileSync(envPath, "utf8");
const key = "CONVERSATION_SESSION_SECRET";
const replacement = `${key}=${randomBytes(48).toString("base64url")}`;
const pattern = new RegExp(`^${key}=.*$`, "m");

if (!pattern.test(contents)) {
  throw new Error(`${key} não foi encontrada no arquivo .env.`);
}

writeFileSync(temporaryPath, contents.replace(pattern, replacement), {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600,
});
renameSync(temporaryPath, envPath);
chmodSync(envPath, 0o600);
