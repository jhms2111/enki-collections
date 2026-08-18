import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const chatSource = readFileSync(resolve("src/modules/webchat/deterministic-webchat.tsx"), "utf8");
const publicPage = readFileSync(resolve("src/app/demo/[slug]/page.tsx"), "utf8");
const styles = readFileSync(resolve("src/app/globals.css"), "utf8");

describe("pure conversational public experience", () => {
  it("renders the transcript with only the initial identifier input", () => {
    expect(chatSource).toContain('role="log"');
    expect(chatSource).toContain("Assistente está digitando");
    expect(chatSource.match(/<form\b/g)).toHaveLength(1);
    expect(chatSource).not.toMatch(/<textarea\b/);
    expect(chatSource.match(/<input\b/g)).toHaveLength(1);
    expect(chatSource.match(/<button\b/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("contains no specialized or clickable workflow controls", () => {
    expect(chatSource).not.toMatch(/<select\b|<fieldset\b|<details\b|quick-replies|chat-option|chat-confirm/);
    expect(chatSource).not.toMatch(/type="radio"|type="date"|type="datetime-local"/);
  });

  it("redirects the old public journey to the same conversation", () => {
    expect(publicPage).toContain("redirect(`/demo/${encodeURIComponent(slug)}/chat`)");
    expect(publicPage).not.toContain("DemoExperience");
  });

  it("requires exact, expiring, conversation-bound typed confirmations", () => {
    for (const phrase of [
      "CONFIRMO O ACEITE", "CONFIRMO A PROMESSA",
      "CONFIRMO O PAGAMENTO INFORMADO", "CONFIRMO A CONTESTAÇÃO",
      "CONFIRMO A INTERRUPÇÃO", "CONFIRMO O ENCERRAMENTO",
    ]) expect(chatSource).toContain(phrase);
    expect(chatSource).toContain("pending.conversationId === conversationId");
    expect(chatSource).toContain("pending.expiresAt > now");
    expect(chatSource).toContain("value.trim() === confirmationPhrase[pending.kind]");
  });

  it("offers only the generic payment page after acceptance", () => {
    expect(chatSource).toContain('label: "Abrir página de pagamento"');
    expect(chatSource).toContain("/payment`");
    expect(chatSource).not.toMatch(/payment.*\?(conversationId|acceptanceId|debtRef|offerRef|token)/i);
    expect(chatSource).not.toContain("createInstrument({ conversationId");
  });

  it("routes essential stateful intents before natural-language interpretation", () => {
    const deterministicRoute = chatSource.indexOf('["LIST_OFFERS", "ACCEPT_OFFER", "REQUEST_INSTRUMENT"]');
    expect(deterministicRoute).toBeGreaterThan(0);
    expect(chatSource).not.toContain("interpretConversationTurn");
    expect(chatSource).toContain('item.status === "AVAILABLE"');
    expect(chatSource).toContain("Expirada e indisponível");
  });

  it("keeps the short guided negotiation flow and hides the identifier until requested", () => {
    expect(chatSource).toContain("Olá! Identificamos uma pendência disponível para negociação.");
    expect(chatSource).toContain('actions: ["Quem somos", "Negociar dívida"]');
    expect(chatSource).toContain('setIdentifierVisible(true)');
    expect(chatSource).toContain('conversation?.identityStatus === "NOT_STARTED" && identifierVisible');
    expect(chatSource).toContain("Encontrei as seguintes pendências disponíveis para consulta");
    expect(chatSource).toContain("Propostas autorizadas:");
  });

  it("preserves canonical review, explicit acceptance and the generic payment path", () => {
    for (const label of [
      "Credor:", "Dívida:", "Modalidade:", "Valor total:", "Entrada:",
      "Parcelas:", "Primeiro vencimento:", "Validade:", "Confirmar aceite",
    ]) expect(chatSource).toContain(label);
    expect(chatSource).toContain("Até este momento, nenhuma proposta foi aceita.");
    expect(chatSource).toContain("Proposta demonstrativa aceita com sucesso.");
    expect(chatSource).toContain('href: `/demo/${encodeURIComponent(slug)}/payment`');
  });

  it("keeps expired offers informational and creates a separate conversation for a new simulation", () => {
    expect(chatSource).toContain('item.status === "AVAILABLE" ? [`${index + 1}.');
    expect(chatSource).toContain('" — Expirada e indisponível"');
    expect(chatSource).toContain('normalize(value) === "confirmar nova simulacao"');
    expect(chatSource).toContain("const created = await createConversation(slug)");
    expect(chatSource).toContain("O aceite anterior permanecerá no histórico demonstrativo");
  });

  it("routes chips and typed text through the same guarded processor", () => {
    expect(chatSource).toContain("void processMessage(text)");
    expect(chatSource).toContain("void processMessage(action)");
    expect(chatSource).toContain("processingRef.current");
    expect(chatSource).toContain('type="button"');
    expect(chatSource).toContain('aria-label="Sugestões de resposta"');
    expect(chatSource).not.toMatch(/onClick=\{[^}]+(acceptOffer|createInstrument|registerPromise|reportPayment|openDispute)/);
  });

  it("checks pending exact confirmation and cancellation before generic classification", () => {
    expect(chatSource.indexOf("if (pending)")).toBeLessThan(chatSource.indexOf("const communicationIntent"));
    expect(chatSource).toContain('normalize(value) === "cancelar"');
    expect(chatSource).toContain('kind === "ACCEPT" ? "Confirmar aceite"');
  });

  it("executes mutations only from the validated pending confirmation branch", () => {
    expect(chatSource).toContain("isExactPendingConfirmation(pending, value, conversation.id)");
    expect(chatSource).toContain("await executePending(pending)");
    expect(chatSource).not.toMatch(/prepareIntent[\s\S]{0,120}await\s+(acceptOffer|createInstrument|registerPromise|reportPayment|openDispute)/);
  });

  it("does not use natural-language interpretation in the guided public flow", () => {
    expect(chatSource).not.toContain("interpretConversationTurn");
  });

  it("keeps accessible mobile messenger structure", () => {
    expect(chatSource).toContain('htmlFor="demoIdentifier"');
    expect(chatSource).toContain('aria-live="polite"');
    expect(styles).toContain("height: 100dvh");
    expect(styles).toContain("env(safe-area-inset-bottom)");
    expect(styles).not.toMatch(/overflow-x:\s*(auto|scroll)/);
  });

  it("does not expose technical vocabulary in visible copy", () => {
    const renderedCopy = chatSource.slice(chatSource.indexOf("return <main"));
    expect(renderedCopy).not.toMatch(/FACT_REF|Policy Gate|OpenAI|backend|provider|fallback/i);
  });

  it("keeps institutional copy outside React and removes the public CPF warning", () => {
    expect(chatSource).not.toContain("Não informe CPF");
    expect(chatSource).not.toContain("Uma empresa de cobrança atua");
    expect(chatSource).not.toContain("interpretConversationTurn");
  });
});
