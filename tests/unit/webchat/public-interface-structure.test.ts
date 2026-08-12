import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const chatSource = readFileSync(resolve("src/modules/webchat/deterministic-webchat.tsx"), "utf8");
const styles = readFileSync(resolve("src/app/globals.css"), "utf8");

describe("public webchat presentation", () => {
  it("keeps opt-out and explicit confirmations in the transcript", () => {
    expect(chatSource).toContain("Interromper mensagens");
    expect(chatSource).toContain("Confirmar aceite demonstrativo");
    expect(chatSource).toContain("Confirmar promessa");
    expect(chatSource).toContain("Confirmar contestação");
  });

  it("prevents duplicate composer submissions while busy", () => {
    expect(chatSource).toContain("if (busy) return;");
    expect(chatSource).toContain("disabled={busy || !composerText.trim()}");
  });

  it("exposes accessible loading, log and composer states", () => {
    expect(chatSource).toContain('role="log"');
    expect(chatSource).toContain('role="status"');
    expect(chatSource).toContain('aria-label="Enviar mensagem"');
  });

  it("has structural mobile, safe-area and reduced-motion support", () => {
    expect(styles).toContain("@media (max-width: 600px)");
    expect(styles).toContain("env(safe-area-inset-bottom)");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
    expect(styles).not.toMatch(/overflow-x:\s*(auto|scroll)/);
  });

  it("does not expose technical vocabulary in visible copy", () => {
    const jsxCopy = chatSource.replace(/const fingerprint[\s\S]*?await run/g, "await run");
    expect(jsxCopy).not.toMatch(/FACT_REF|Policy Gate|OpenAI|backend|provider|fallback/i);
  });
});
