import { describe, expect, it } from "vitest";

import { institutionalIdentity, institutionalKnowledgeVersion, resolveInstitutionalQuestion } from "@/modules/webchat/institutional-knowledge";

const debtFacts = [
  { key: "debt_creditor", displayText: "Credor: Credor fictício." },
  { key: "debt_description", displayText: "Descrição da dívida: Conta demonstrativa." },
  { key: "debt_amount", displayText: "Valor informado: R$ 450,00." },
  { key: "debt_due_date", displayText: "Vencimento informado: 15 de agosto de 2099." },
  { key: "debt_status", displayText: "Situação informada: em aberto." },
];

describe("versioned demonstrative institutional knowledge", () => {
  it("is explicitly demonstrative and replaceable", () => {
    expect(institutionalKnowledgeVersion).toMatch(/demo/);
    expect(institutionalIdentity.name).toContain("Demonstrativo");
    expect(institutionalIdentity.nature).toContain("fictício");
  });

  it.each([
    ["quem são vocês?", "empresa de cobrança"],
    ["isso é golpe?", "Nunca envie senha"],
    ["quando meu nome sai do Serasa?", "cinco dias úteis"],
    ["e do SPC?", "cinco dias úteis"],
    ["paguei, quando atualiza?", "não significa confirmação"],
    ["meu score aumenta?", "não controlam o score"],
    ["posso pagar por Pix?", "somente textos não pagáveis"],
    ["o boleto demora para compensar?", "identificado e confirmado"],
    ["não consigo pagar agora", "promessa"],
    ["a parcela atrasou", "não recalcula"],
    ["quero falar com uma pessoa", "não está integrado"],
  ])("answers %s safely", (question, expected) => {
    expect(resolveInstitutionalQuestion(question, { identityVerified: false, facts: [] })?.message).toContain(expected);
  });

  it("requires identity for a specific collection and uses only canonical facts afterward", () => {
    const before = resolveInstitutionalQuestion("por que estão me cobrando?", { identityVerified: false, facts: [] });
    expect(before?.message).toContain("localizar e validar");
    expect(before?.message).not.toContain("R$");
    const after = resolveInstitutionalQuestion("por que estão me cobrando?", { identityVerified: true, facts: debtFacts });
    expect(after?.message).toContain("Credor fictício");
    expect(after?.message).toContain("R$ 450,00");
  });

  it("keeps safe context for short follow-ups", () => {
    const first = resolveInstitutionalQuestion("quando meu nome sai do SPC?", { identityVerified: false, facts: [] })!;
    const next = resolveInstitutionalQuestion("e depois?", { identityVerified: false, facts: [], lastSubject: first.subject });
    expect(next?.message).toContain("cinco dias úteis");
  });

  it("does not validate an unrecognized debt automatically", () => {
    const answer = resolveInstitutionalQuestion("não reconheço essa dívida", { identityVerified: true, facts: debtFacts });
    expect(answer?.intent).toBe("DISPUTE_DEBT");
    expect(answer?.message).toContain("não significa que a dívida foi considerada válida ou inválida");
  });
});
