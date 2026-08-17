import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const chatSource = readFileSync(resolve("src/modules/webchat/deterministic-webchat.tsx"), "utf8");
const journeySource = readFileSync(resolve("src/modules/demo-ui/demo-experience.tsx"), "utf8");
const styles = readFileSync(resolve("src/app/globals.css"), "utf8");

describe("public webchat presentation", () => {
  it("keeps only communication controls in the transcript", () => {
    expect(chatSource).toContain("Interromper mensagens");
    expect(chatSource).toContain("Encerrar este atendimento?");
    expect(chatSource).not.toMatch(/acceptOffer|createInstrument|registerPromise|reportPayment|openDispute/);
    expect(chatSource).not.toMatch(/Confirmar aceite|Confirmar promessa|Confirmar contesta/);
  });

  it("offers a generic, context-free link to the secure journey", () => {
    expect(chatSource).toContain("Acessar negociação e pagamento");
    expect(chatSource).toContain('return "/demo/jf-demo"');
    expect(chatSource).not.toMatch(/href=.*(conversationId|debtRef|offerRef|acceptanceId|identifier)/);
    expect(chatSource).toContain("precisará informar novamente seu identificador e validar sua identidade");
  });

  it("keeps debt and offer selection informational", () => {
    expect(chatSource).toContain("getDebt");
    expect(chatSource).toContain("listOffers");
    expect(chatSource).toContain("selecionada apenas para explicação");
    expect(chatSource).toContain("Nenhuma decisão foi registrada");
  });

  it("preserves all mutable operations exclusively in the guided journey", () => {
    for (const operation of ["acceptOffer", "createInstrument", "registerPromise", "reportPayment", "openDispute"]) {
      expect(journeySource).toContain(operation);
      expect(chatSource).not.toContain(operation);
    }
  });

  it("prevents duplicate composer submissions while busy", () => {
    expect(chatSource).toContain("if (busy || !conversation) return;");
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
    expect(chatSource).not.toMatch(/FACT_REF|Policy Gate|OpenAI|backend|provider|fallback/i);
  });
});
