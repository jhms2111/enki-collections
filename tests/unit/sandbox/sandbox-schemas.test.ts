import { describe, expect, it } from "vitest";
import { sandboxScenarioInputSchema } from "@/modules/sandbox/sandbox.schemas";

const valid = () => ({ demoConfirmation: true, profile: { profileRef: "profile-demo", demoIdentifier: "DEMO-NOVA-001", maskedDisplayName: "Pessoa Demonstração N." }, challenge: { challengeRef: "challenge-demo", prompt: "Qual opção fictícia foi combinada?", correctOptionRef: "option-b", options: [{ optionRef: "option-a", label: "Azul demo" }, { optionRef: "option-b", label: "Verde demo" }] }, creditor: { creditorRef: "creditor-demo", displayName: "Credor Demonstrativo Novo" }, debtor: { debtorRef: "debtor-demo" }, debt: { debtRef: "debt-demo", description: "Contrato inteiramente fictício", amountInCents: 10000, dueDate: "2099-01-01", status: "OPEN" }, offers: [{ offerRef: "offer-demo", kind: "INSTALLMENT", totalAmountInCents: 9999, downPaymentAmountInCents: 123, installmentCount: 7, installmentAmountInCents: 456, firstDueDate: "2099-01-02", expiresAt: "2099-01-01T23:59:59.000Z", status: "AVAILABLE" }] });

describe("sandboxScenarioInputSchema", () => {
  it("aceita termos explícitos sem calcular ou corrigir fórmula financeira", () => { const result = sandboxScenarioInputSchema.parse(valid()); expect(result.offers[0].totalAmountInCents).toBe(9999); expect(result.offers[0].installmentAmountInCents).toBe(456); });
  it("exige DEMO-, confirmação e rejeita campos extras", () => { expect(() => sandboxScenarioInputSchema.parse({ ...valid(), demoConfirmation: false })).toThrow(); const input = valid(); input.profile.demoIdentifier = "12345678901"; expect(() => sandboxScenarioInputSchema.parse(input)).toThrow(); expect(() => sandboxScenarioInputSchema.parse({ ...valid(), cpf: "00000000000" })).toThrow(); });
  it("rejeita padrões conservadores de dados pessoais", () => { const input = valid(); input.profile.maskedDisplayName = "Contato teste@example.com"; expect(() => sandboxScenarioInputSchema.parse(input)).toThrow(); });
  it("exige resposta correta entre opções sem expor outra estrutura", () => { const input = valid(); input.challenge.correctOptionRef = "option-x"; expect(() => sandboxScenarioInputSchema.parse(input)).toThrow(); });
});
