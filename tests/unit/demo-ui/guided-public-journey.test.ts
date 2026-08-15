import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const journey = readFileSync(resolve("src/modules/demo-ui/demo-experience.tsx"), "utf8");
const assistant = readFileSync(resolve("src/modules/demo-ui/guided-assistant.tsx"), "utf8");
const styles = readFileSync(resolve("src/app/globals.css"), "utf8");

describe("guided public journey", () => {
  it("keeps a single primary decision through all approved stages", () => {
    for (const label of ["Começar demonstração", "Continuar", "Validar identidade", "Ver opções", "Ver propostas", "Escolher esta proposta", "Confirmar proposta", "Gerar link demonstrativo"]) {
      expect(journey).toContain(label);
    }
    expect(journey).toContain("Etapa {progress.current} de 8");
  });

  it("keeps explicit alternative and terminal actions", () => {
    expect(journey).toContain("Outras opções");
    expect(journey).toContain("Solicitar atendimento humano");
    expect(journey).toContain("Interromper mensagens");
    expect(journey).toContain("Encerrar atendimento");
  });

  it("passes only selected references and context to the explanatory assistant", () => {
    expect(assistant).toContain("selectedDebtRef");
    expect(assistant).toContain("selectedOfferRef");
    expect(assistant).toContain("uiContext");
    expect(assistant).not.toMatch(/acceptOffer|createInstrument|registerPromise|reportPayment|openDispute/);
  });

  it("states that human handoff is not real", () => {
    expect(journey).toContain("nenhuma transferência real foi iniciada");
  });

  it("provides mobile layout, large controls and no horizontal page scrolling", () => {
    expect(styles).toContain("@media (max-width: 600px)");
    expect(styles).toContain("min-height: 48px");
    expect(styles).not.toMatch(/\.guided-page[^}]*overflow-x:\s*(auto|scroll)/);
  });
});
