"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  closeConversation, createConversation, DemoApiError, getChallenge, getConversation,
  getDebt, identify, interpretConversationTurn, listDebts, listOffers,
  optOutConversation, verifyIdentity,
  type Conversation, type CreditorGroup, type Debt, type Offer, type PublicChallenge,
} from "@/modules/demo-ui/demo-api";
import { interpretSafeChatText } from "./deterministic-intent";

type ChatMessage = Readonly<{ id: string; actor: "bot" | "user"; text: string }>;
type TerminalConfirmation = "close" | "opt-out" | null;

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatMoney = (cents: number) => money.format(cents / 100);
const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" })
  .format(new Date(`${value.slice(0, 10)}T12:00:00.000Z`));

function safeError(error: unknown) {
  if (error instanceof DemoApiError) {
    if (error.status === 429) return "Muitas tentativas. Aguarde um pouco antes de continuar.";
    if (error.status >= 500) return "A demonstração está temporariamente indisponível.";
    return error.message;
  }
  return "Não foi possível concluir esta etapa. Tente novamente.";
}

export function secureJourneyPath(): "/demo/jf-demo" { return "/demo/jf-demo"; }
export function clearPreviousJourneyReference(storage: Pick<Storage, "removeItem">): void {
  storage.removeItem("enki-demo:conversation:jf-demo");
}
export function scrollChatEnd(element: HTMLDivElement | null): void {
  element?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}
export function shouldSubmitComposerKey(key: string, shiftKey: boolean): boolean {
  return key === "Enter" && !shiftKey;
}

export function DeterministicWebchat({ slug, version }: { slug: string; version: string }) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [challenge, setChallenge] = useState<PublicChallenge | null>(null);
  const [creditors, setCreditors] = useState<readonly CreditorGroup[]>([]);
  const [debt, setDebt] = useState<(Debt & { creditor: { displayName: string } }) | null>(null);
  const [offers, setOffers] = useState<readonly Offer[]>([]);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [messages, setMessages] = useState<readonly ChatMessage[]>([
    { id: "welcome", actor: "bot", text: "Olá! Posso localizar informações demonstrativas, explicar dívidas e mostrar as formas de pagamento autorizadas." },
  ]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [terminalConfirmation, setTerminalConfirmation] = useState<TerminalConfirmation>(null);
  const [composerText, setComposerText] = useState("");
  const logEnd = useRef<HTMLDivElement>(null);
  const storageKey = `enki-chat:conversation:${slug}`;
  const terminal = conversation?.state === "CLOSED" || conversation?.state === "OPTED_OUT";

  const bot = useCallback((text: string) => setMessages((current) => [
    ...current, { id: crypto.randomUUID(), actor: "bot", text },
  ]), []);
  const user = useCallback((text: string) => setMessages((current) => [
    ...current, { id: crypto.randomUUID(), actor: "user", text },
  ]), []);

  const loadSafeState = useCallback(async (current: Conversation) => {
    if (current.state === "CLOSED" || current.state === "OPTED_OUT") return;
    if (current.identityStatus === "PENDING") {
      setChallenge((await getChallenge(current.id)).challenge);
    } else if (current.identityStatus === "VERIFIED") {
      setCreditors((await listDebts(current.id)).creditors);
    }
  }, []);

  useEffect(() => {
    const reference = sessionStorage.getItem(storageKey);
    if (!reference) { queueMicrotask(() => setBusy(false)); return; }
    getConversation(reference).then(async ({ conversation: restored }) => {
      setConversation(restored); await loadSafeState(restored);
      bot(restored.state === "OPTED_OUT" ? "As mensagens foram interrompidas. Esta conversa permanece encerrada."
        : restored.state === "CLOSED" ? "Esta conversa já foi encerrada. Ela não será reaberta automaticamente."
          : "Retomamos no ponto seguro mais próximo do atendimento.");
    }).catch(() => {
      sessionStorage.removeItem(storageKey);
      bot("O atendimento anterior não está mais disponível. Inicie uma nova conversa.");
    }).finally(() => setBusy(false));
  }, [bot, loadSafeState, storageKey]);
  useEffect(() => scrollChatEnd(logEnd.current), [messages, busy]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); } catch (caught) { setError(safeError(caught)); }
    finally { setBusy(false); }
  }
  async function start() {
    await run(async () => {
      const result = await createConversation(slug);
      setConversation(result.conversation); sessionStorage.setItem(storageKey, result.conversation.id);
      bot("Para começar, informe somente um identificador fictício no formato DEMO-*. Nunca informe CPF ou dado pessoal real.");
    });
  }
  async function submitIdentifier(event: React.FormEvent) {
    event.preventDefault(); if (!conversation) return; user(identifier);
    await run(async () => {
      const result = await identify(conversation.id, identifier);
      setConversation(result.conversation); setChallenge(result.challenge); setIdentifier("");
      bot("Identificador fictício localizado. Responda ao desafio simulado. Nenhuma dívida foi revelada.");
    });
  }
  async function chooseChallenge(optionRef: string, label: string) {
    if (!conversation) return; user(label);
    await run(async () => {
      const result = await verifyIdentity(conversation.id, optionRef); setConversation(result.conversation);
      if (result.verified) {
        setChallenge(null); setCreditors((await listDebts(conversation.id)).creditors);
        bot("Identidade fictícia validada. Agora posso mostrar um resumo das dívidas demonstrativas.");
      } else if (result.conversation.identityStatus === "BLOCKED") {
        setChallenge(null); bot("O limite de três tentativas foi atingido. O atendimento foi bloqueado e nenhuma dívida foi revelada.");
      } else {
        setChallenge((await getChallenge(conversation.id)).challenge);
        bot(`Resposta não validada. Restam ${result.attemptsRemaining} tentativa(s).`);
      }
    });
  }
  async function chooseDebt(debtRef: string, description: string) {
    if (!conversation) return; user(`Quero saber mais sobre: ${description}`);
    await run(async () => {
      const [{ debt: selected }, available] = await Promise.all([
        getDebt(conversation.id, debtRef), listOffers(conversation.id, debtRef),
      ]);
      setDebt(selected); setOffers(available.offers); setOffer(null);
      bot("Posso explicar esta dívida e as propostas autorizadas. Para negociar ou escolher uma forma de pagamento, use a área segura indicada abaixo.");
    });
  }
  async function terminalAction(kind: Exclude<TerminalConfirmation, null>) {
    if (!conversation) return;
    await run(async () => {
      const result = kind === "opt-out" ? await optOutConversation(conversation.id) : await closeConversation(conversation.id);
      setConversation(result.conversation); setTerminalConfirmation(null);
      bot(kind === "opt-out" ? "As mensagens foram interrompidas." : "Atendimento encerrado.");
    });
  }
  async function submitText(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !conversation) return;
    const text = composerText; if (!text.trim()) return;
    user(text); setComposerText(""); setBusy(true); setError(null);
    try {
      const result = await interpretConversationTurn({
        conversationId: conversation.id, message: text, clientTurnId: crypto.randomUUID(),
        uiContext: conversation.identityStatus !== "VERIFIED" ? "IDENTITY" : !debt ? "DEBT_LIST" : offer ? "OFFER_REVIEW" : "DEBT_DETAIL",
        ...(debt ? { selectedDebtRef: debt.debtRef } : {}), ...(offer ? { selectedOfferRef: offer.offerRef } : {}),
      });
      bot(result.turn.message);
    } catch {
      const intent = interpretSafeChatText(text);
      bot(intent === "HELP" ? "Posso explicar as informações disponíveis. Para negociar ou pagar, use a área segura indicada abaixo."
        : intent === "LIST_DEBTS" && conversation.identityStatus === "VERIFIED" ? "As dívidas disponíveis aparecem nas opções desta conversa."
          : intent === "LIST_OFFERS" && debt ? "As propostas autorizadas aparecem abaixo do resumo da dívida."
            : "Não entendi com segurança. Escolha uma opção exibida ou faça uma pergunta curta; nenhuma ação foi executada.");
    } finally { setBusy(false); }
  }

  return <main className="chat-page">
    <header className="chat-header"><a className="brand" href={`/demo/${encodeURIComponent(slug)}`}><span className="brand-mark" aria-hidden="true">E</span><span>ENKI <strong>Collections</strong></span></a><span className="chat-demo-chip">Demonstração · sem valor financeiro</span></header>
    <section className="chat-shell" aria-label="Atendimento digital demonstrativo">
      <div className="chat-title"><a className="chat-back" aria-label="Voltar ao início" href={`/demo/${encodeURIComponent(slug)}`}>←</a><span className="assistant-avatar" aria-hidden="true">E</span><div><h1>Assistente ENKI</h1><p><span className="status-dot" />Atendimento digital</p></div><div className="chat-header-actions"><button className="chat-stop" disabled={!conversation || terminal || busy} onClick={() => setTerminalConfirmation("opt-out")}>Interromper mensagens</button><button className="chat-menu" aria-label="Encerrar conversa" disabled={!conversation || terminal || busy} onClick={() => setTerminalConfirmation("close")}>•••</button></div></div>
      <div className="chat-log" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((message) => <div className={`chat-bubble ${message.actor}`} key={message.id}><span>{message.actor === "bot" ? "ENKI demo" : "Você"}</span><p>{message.text}</p></div>)}
        {error && <div className="alert error" role="alert">{error}</div>}
        {busy && <div className="typing" role="status"><span aria-hidden="true"><i /><i /><i /></span>Assistente está digitando…</div>}
        <div ref={logEnd} />
      </div>
      <div className="chat-actions">
        {!conversation && <button className="button primary" onClick={() => void start()} disabled={busy}>Iniciar conversa</button>}
        {conversation && !terminal && conversation.identityStatus === "NOT_STARTED" && <form className="chat-form" onSubmit={submitIdentifier}><label htmlFor="chatIdentifier">Identificador demonstrativo</label><input id="chatIdentifier" value={identifier} onChange={(event) => setIdentifier(event.target.value.toUpperCase())} pattern="DEMO-[A-Z0-9]{2,16}-[A-Z0-9]{3,8}" maxLength={48} required /><button className="button primary" disabled={busy}>Continuar</button></form>}
        {conversation && !terminal && conversation.identityStatus === "PENDING" && challenge && <fieldset><legend>{challenge.prompt} · {challenge.attemptsRemaining} tentativa(s)</legend><div className="quick-replies">{challenge.options.map((option) => <button type="button" className="button secondary" key={option.optionRef} disabled={busy} onClick={() => void chooseChallenge(option.optionRef, option.label)}>{option.label}</button>)}</div></fieldset>}
        {conversation?.identityStatus === "BLOCKED" && !terminal && <p className="terminal-note" role="alert">Atendimento bloqueado após três falhas. Nenhuma dívida foi revelada.</p>}
        {conversation?.identityStatus === "VERIFIED" && !terminal && !debt && <div><h2>Sobre qual dívida deseja conversar?</h2>{creditors.map((creditor) => <section className="chat-group" key={creditor.creditorRef}><h3>{creditor.displayName}</h3>{creditor.debts.map((item) => <button type="button" className="chat-option" key={item.debtRef} onClick={() => void chooseDebt(item.debtRef, item.description)}><span>{item.description} · vence {formatDate(item.dueDate)}</span><strong>{formatMoney(item.amount.amountInCents)}</strong></button>)}</section>)}</div>}
        {conversation?.identityStatus === "VERIFIED" && !terminal && debt && <div className="chat-negotiation"><button type="button" className="text-button" onClick={() => { setDebt(null); setOffer(null); setOffers([]); }}>← Escolher outra dívida</button><div className="selected-debt"><span>{debt.creditor.displayName}</span><strong>{debt.description}</strong><p>{formatMoney(debt.amount.amountInCents)} · vence {formatDate(debt.dueDate)} · {debt.status}</p></div><h3>Formas autorizadas disponíveis</h3>{offers.length === 0 && <p>Nenhuma proposta autorizada está disponível no momento.</p>}{offers.map((item) => <button type="button" className="chat-option" key={item.offerRef} disabled={item.status !== "AVAILABLE"} onClick={() => { setOffer(item); bot("Esta proposta foi selecionada apenas para explicação. Nenhuma decisão foi registrada."); }}><span>{item.terms.kind === "CASH" ? "À vista" : `${item.terms.installmentCount} parcelas`} · primeiro vencimento {formatDate(item.terms.firstDueDate)}</span><strong>{formatMoney(item.terms.total.amountInCents)}</strong></button>)}{offer && <div className="chat-info-card"><strong>{offer.terms.kind === "CASH" ? "Proposta à vista" : "Proposta parcelada"}</strong><p>Total: {formatMoney(offer.terms.total.amountInCents)}</p>{offer.terms.kind === "INSTALLMENT" && <p>Entrada: {formatMoney(offer.terms.downPayment.amountInCents)} · {offer.terms.installmentCount} parcelas de {formatMoney(offer.terms.installmentAmount.amountInCents)}</p>}<p>Primeiro vencimento: {formatDate(offer.terms.firstDueDate)} · válida até {formatDate(offer.expiresAt)}</p><button type="button" className="button secondary" onClick={() => setOffer(null)}>Fechar detalhes</button></div>}<div className="secure-journey-card"><strong>Negociação e pagamento em área separada</strong><p>Para sua segurança, a negociação e a escolha da forma de pagamento são realizadas em uma área separada. Ao continuar, você precisará informar novamente seu identificador e validar sua identidade.</p><a className="button primary" href={secureJourneyPath()} onClick={() => clearPreviousJourneyReference(sessionStorage)}>Acessar negociação e pagamento</a></div></div>}
        {terminal && <div className="terminal-note" role="status"><strong>{conversation?.state === "OPTED_OUT" ? "Mensagens interrompidas" : "Atendimento encerrado"}</strong><p>Esta conversa não será reaberta automaticamente.</p><button className="button secondary" onClick={() => { sessionStorage.removeItem(storageKey); location.reload(); }}>Criar nova conversa</button></div>}
        {conversation && !terminal && <form className="chat-text" onSubmit={submitText}><label className="sr-only" htmlFor="chatText">Mensagem</label><div><textarea id="chatText" rows={1} maxLength={160} autoComplete="off" value={composerText} onChange={(event) => { setComposerText(event.target.value); event.currentTarget.style.height = "auto"; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`; }} onKeyDown={(event) => { if (shouldSubmitComposerKey(event.key, event.shiftKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Digite sua mensagem…" /><button className="chat-send" aria-label="Enviar mensagem" disabled={busy || !composerText.trim()}><span aria-hidden="true">→</span></button></div><small>O atendimento explica informações. Negociação e pagamento acontecem somente na área segura.</small></form>}
        {terminalConfirmation && <div className="terminal-confirm" role="dialog" aria-modal="true" aria-labelledby="terminal-title"><h2 id="terminal-title">{terminalConfirmation === "opt-out" ? "Interromper todas as mensagens?" : "Encerrar este atendimento?"}</h2><p>Esta ação encerra a comunicação e não executa nenhuma negociação.</p><button autoFocus className="button primary" onClick={() => void terminalAction(terminalConfirmation)}>Confirmar</button><button className="button secondary" onClick={() => setTerminalConfirmation(null)}>Voltar</button></div>}
      </div>
    </section>
    <footer className="chat-footer"><strong>DEMONSTRAÇÃO — SEM VALOR FINANCEIRO</strong><span>ENKI Collections · v{version}</span></footer>
  </main>;
}
