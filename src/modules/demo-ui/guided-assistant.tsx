"use client";

import { useState } from "react";

import { interpretConversationTurn, type Conversation } from "./demo-api";

type AssistantMessage = Readonly<{ actor: "assistant" | "user"; text: string }>;

const suggestions = [
  "Explique esta dívida",
  "Explique esta proposta",
  "O que significa entrada?",
  "Quando vence?",
  "Como funciona a contestação?",
] as const;

export function GuidedAssistant({ open, onClose, conversation, selectedDebtRef, selectedOfferRef, uiContext }: {
  open: boolean;
  onClose: () => void;
  conversation: Conversation | null;
  selectedDebtRef?: string;
  selectedOfferRef?: string;
  uiContext: "IDENTITY" | "DEBT_LIST" | "DEBT_DETAIL" | "OFFER_REVIEW" | "ACCEPTED";
}) {
  const [messages, setMessages] = useState<readonly AssistantMessage[]>([
    { actor: "assistant", text: "Olá! Posso explicar as informações desta etapa. Suas decisões continuam nos botões da jornada." },
  ]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(message: string) {
    const clean = message.trim();
    if (!clean || !conversation || busy) return;
    setMessages((current) => [...current, { actor: "user", text: clean }]);
    setText(""); setBusy(true); setError(null);
    try {
      const result = await interpretConversationTurn({
        conversationId: conversation.id, message: clean, clientTurnId: crypto.randomUUID(), uiContext,
        ...(selectedDebtRef ? { selectedDebtRef } : {}),
        ...(selectedOfferRef ? { selectedOfferRef } : {}),
      });
      setMessages((current) => [...current, { actor: "assistant", text: result.turn.message }]);
    } catch {
      setError("Não consegui responder agora. A jornada continua disponível normalmente.");
    } finally { setBusy(false); }
  }

  if (!open) return null;
  return (
    <aside className="guide-assistant" aria-label="Tirar dúvidas com assistente virtual">
      <header><div><strong>Assistente ENKI</strong><span>Ajuda sobre esta etapa</span></div><button type="button" onClick={onClose}>Fechar</button></header>
      <div className="assistant-messages" role="log" aria-live="polite">
        {messages.map((message, index) => <p className={message.actor} key={`${message.actor}-${index}`}>{message.text}</p>)}
        {busy && <p className="assistant" role="status">Preparando uma explicação…</p>}
        {error && <p className="assistant-error" role="alert">{error}</p>}
      </div>
      <div className="assistant-suggestions" aria-label="Perguntas sugeridas">
        {suggestions.map((suggestion) => <button type="button" disabled={!conversation || busy} onClick={() => void ask(suggestion)} key={suggestion}>{suggestion}</button>)}
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void ask(text); }}>
        <label htmlFor="assistant-question">Sua dúvida</label>
        <div><input id="assistant-question" value={text} onChange={(event) => setText(event.target.value)} maxLength={160} placeholder="Digite uma pergunta" /><button disabled={!conversation || busy || !text.trim()}>Enviar</button></div>
      </form>
      <small>A assistente explica informações, mas não confirma ou executa decisões.</small>
    </aside>
  );
}
