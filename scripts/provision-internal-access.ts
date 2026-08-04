import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { createInternalAccessCredentials, readInternalAccessCodeFromStdin } from "../src/shared/auth/internal-access-provisioning";

const projectDirectory = process.cwd();
const envPath = resolve(projectDirectory, ".env");
const vercelScope = "jhms2111s-projects";

function setVercelProductionVariable(name: string, value: string): void {
  if (name !== "INTERNAL_ACCESS_HMAC_SECRET" && name !== "INTERNAL_ACCESS_CODE_HASH") {
    throw new Error("Nome de variavel interna nao autorizado.");
  }
  const executable = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npx";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npx.cmd --yes vercel@latest env add ${name} production --sensitive --force --yes --scope ${vercelScope}`]
    : ["--yes", "vercel@latest", "env", "add", name, "production", "--sensitive", "--force", "--yes", "--scope", vercelScope];
  const result = spawnSync(
    executable,
    args,
    { cwd: projectDirectory, input: `${value}\n`, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    throw new Error(`Falha ao configurar ${name} na Vercel Production.`);
  }
}

function setLocalEnvironmentVariable(source: string, name: string, value: string): string {
  const line = `${name}=${value}`;
  const pattern = new RegExp(`^${name}=.*$`, "m");
  if (pattern.test(source)) return source.replace(pattern, line);
  return `${source.replace(/\s*$/, "")}\n${line}\n`;
}

let code: string | undefined;
let credentials: ReturnType<typeof createInternalAccessCredentials> | undefined;

try {
  code = await readInternalAccessCodeFromStdin(process.stdin);
  credentials = createInternalAccessCredentials(code);
  setVercelProductionVariable("INTERNAL_ACCESS_HMAC_SECRET", credentials.secret);
  setVercelProductionVariable("INTERNAL_ACCESS_CODE_HASH", credentials.codeHash);

  const currentEnv = readFileSync(envPath, "utf8");
  const withSecret = setLocalEnvironmentVariable(currentEnv, "INTERNAL_ACCESS_HMAC_SECRET", credentials.secret);
  const updatedEnv = setLocalEnvironmentVariable(withSecret, "INTERNAL_ACCESS_CODE_HASH", credentials.codeHash);
  writeFileSync(envPath, updatedEnv, { encoding: "utf8", mode: 0o600 });

  process.stdout.write("Variaveis configuradas: INTERNAL_ACCESS_HMAC_SECRET, INTERNAL_ACCESS_CODE_HASH.\n");
  process.stdout.write("Nenhum deployment foi iniciado.\n");
} finally {
  code = undefined;
  credentials = undefined;
}
