import { describe, expect, it } from "vitest";

import { sandboxScenarioInputSchema } from "@/modules/sandbox/sandbox.schemas";
import { createSandboxReferences } from "@/modules/sandbox/sandbox-service";

const valid = () => ({
  demoConfirmation: true,
  scenarioName: " Cenário Demonstrativo Aurora ",
  debtor: { displayName: " Pessoa Fictícia N. " },
  challenge: { prompt: " Qual opção fictícia foi combinada? ", correctOptionIndex: 1, options: [{ label: " Azul demo " }, { label: " Verde demo " }] },
  creditor: { displayName: " Credor Demonstrativo Novo " },
  debt: { description: " Contrato inteiramente fictício ", amountInCents: 10000, dueDate: "2099-01-01" },
  offers: [{ kind: "INSTALLMENT", totalAmountInCents: 9999, downPaymentAmountInCents: 123, installmentCount: 7, installmentAmountInCents: 456, firstDueDate: "2099-01-02", expiresAt: "2099-01-01T23:59:59.000Z" }],
});

describe("sandboxScenarioInputSchema", () => {
  it("aceita termos explícitos sem calcular ou corrigir fórmula financeira", () => { const result = sandboxScenarioInputSchema.parse(valid()); expect(result.offers[0].totalAmountInCents).toBe(9999); expect(result.offers[0].installmentAmountInCents).toBe(456); });
  it("remove somente espaços nas extremidades dos textos comuns", () => { const result = sandboxScenarioInputSchema.parse(valid()); expect(result.scenarioName).toBe("Cenário Demonstrativo Aurora"); expect(result.debtor.displayName).toBe("Pessoa Fictícia N."); expect(result.challenge.options[0].label).toBe("Azul demo"); });
  it("exige confirmação e rejeita referências ou versões enviadas pelo navegador", () => { expect(() => sandboxScenarioInputSchema.parse({ ...valid(), demoConfirmation: false })).toThrow(); expect(() => sandboxScenarioInputSchema.parse({ ...valid(), profileRef: "profile-user" })).toThrow(); const input = valid() as ReturnType<typeof valid> & { offers: Array<Record<string, unknown>> }; input.offers[0].offerRef = "offer-user"; expect(() => sandboxScenarioInputSchema.parse(input)).toThrow(); });
  it("rejeita padrões conservadores de dados pessoais", () => { const input = valid(); input.debtor.displayName = "Contato teste@example.com"; expect(() => sandboxScenarioInputSchema.parse(input)).toThrow(); });
  it("exige que o índice correto identifique uma opção existente", () => { const input = valid(); input.challenge.correctOptionIndex = 4; expect(() => sandboxScenarioInputSchema.parse(input)).toThrow(); });
  it("gera identificador DEMO legível e referências opacas únicas exclusivamente no servidor", () => { const first = createSandboxReferences("Cenário Lúmen Fictício"); const second = createSandboxReferences("Cenário Lúmen Fictício"); expect(first.identifier).toMatch(/^DEMO-LUMEN-[A-Z0-9]{4}$/); expect(first.identifier).not.toBe(second.identifier); expect(first.profile).not.toBe(second.profile); expect(first.debt).not.toBe(second.debt); expect(Object.values(first)).toHaveLength(new Set(Object.values(first)).size); });
});
