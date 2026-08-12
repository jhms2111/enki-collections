"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  acceptOffer,
  closeConversation,
  createConversation,
  createInstrument,
  DemoApiError,
  getChallenge,
  getConversation,
  getDebt,
  identify,
  interpretConversationTurn,
  listDebts,
  listOffers,
  openDispute,
  optOutConversation,
  registerPromise,
  reportPayment,
  verifyIdentity,
  type Conversation,
  type CreditorGroup,
  type Debt,
  type Offer,
  type PublicChallenge,
} from "@/modules/demo-ui/demo-api";
import { clearIntentKey, getIntentKey } from "@/modules/demo-ui/idempotency-client";

import { interpretSafeChatText } from "./deterministic-intent";

type ChatMessage = Readonly<{ id: string; actor: "bot" | "user"; text: string }>;
type TerminalConfirmation = "close" | "opt-out" | null;

const moneyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatMoney = (cents: number) => moneyFormatter.format(cents / 100);
const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", {
  dateStyle: "medium",
  timeZone: "UTC",
}).format(new Date(`${value.slice(0, 10)}T12:00:00.000Z`));

function safeError(error: unknown) {
  if (error instanceof DemoApiError) {
    if (error.status === 429) return "Muitas tentativas. Aguarde um pouco antes de continuar.";
    if (error.status >= 500) return "A demonstração está temporariamente indisponível.";
    return error.message;
  }
  return "Não foi possível concluir esta etapa. Tente novamente.";
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
  const [acceptanceId, setAcceptanceId] = useState<string | null>(null);
  const [instrument, setInstrument] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly ChatMessage[]>([
    { id: "welcome", actor: "bot", text: "Olá! Este é um atendimento demonstrativo com dados inteiramente fictícios e sem valor financeiro." },
  ]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("");
  const [terminalConfirmation, setTerminalConfirmation] = useState<TerminalConfirmation>(null);
  const [composerText, setComposerText] = useState("");
  const logEnd = useRef<HTMLDivElement>(null);
  const storageKey = `enki-chat:conversation:${slug}`;
  const terminal = conversation?.state === "CLOSED" || conversation?.state === "OPTED_OUT";

  const bot = useCallback((text: string) => {
    setMessages((current) => [...current, { id: crypto.randomUUID(), actor: "bot", text }]);
  }, []);
  const user = useCallback((text: string) => {
    setMessages((current) => [...current, { id: crypto.randomUUID(), actor: "user", text }]);
  }, []);

  const loadSafeState = useCallback(async (current: Conversation) => {
    if (current.state === "CLOSED" || current.state === "OPTED_OUT") return;
    if (current.identityStatus === "PENDING") {
      const result = await getChallenge(current.id);
      setChallenge(result.challenge);
      return;
    }
    if (current.identityStatus === "VERIFIED") {
      const result = await listDebts(current.id);
      setCreditors(result.creditors);
    }
  }, []);

  useEffect(() => {
    const reference = sessionStorage.getItem(storageKey);
    if (!reference) {
      queueMicrotask(() => setBusy(false));
      return;
    }
    getConversation(reference)
      .then(async ({ conversation: restored }) => {
        setConversation(restored);
        await loadSafeState(restored);
        bot(restored.state === "OPTED_OUT"
          ? "As mensagens foram interrompidas. Esta conversa permanece encerrada."
          : restored.state === "CLOSED"
            ? "Esta conversa já foi encerrada. Ela não será reaberta automaticamente."
            : "Retomamos no ponto seguro mais próximo da sua demonstração.");
      })
      .catch(() => {
        sessionStorage.removeItem(storageKey);
        bot("A sessão anterior não está disponível. Inicie uma nova conversa.");
      })
      .finally(() => setBusy(false));
  }, [bot, loadSafeState, storageKey]);

  useEffect(() => scrollChatEnd(logEnd.current), [messages, busy]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try { await action(); } catch (caught) { setError(safeError(caught)); }
    finally { setBusy(false); }
  }

  async function start() {
    await run(async () => {
      const result = await createConversation(slug);
      setConversation(result.conversation);
      sessionStorage.setItem(storageKey, result.conversation.id);
      bot("Para começar, informe somente um identificador fictício no formato DEMO-*. Nunca informe CPF ou dado pessoal real.");
    });
  }

  async function submitIdentifier(event: React.FormEvent) {
    event.preventDefault();
    if (!conversation) return;
    user(identifier);
    await run(async () => {
      const result = await identify(conversation.id, identifier);
      setConversation(result.conversation);
      setChallenge(result.challenge);
      setIdentifier("");
      bot("Identificador fictício localizado. Responda ao desafio simulado. Nenhuma dívida foi revelada.");
    });
  }

  async function chooseChallenge(optionRef: string, label: string) {
    if (!conversation) return;
    user(label);
    await run(async () => {
      const result = await verifyIdentity(conversation.id, optionRef);
      setConversation(result.conversation);
      if (result.verified) {
        setChallenge(null);
        const listed = await listDebts(conversation.id);
        setCreditors(listed.creditors);
        bot("Identidade fictícia validada. Agora posso mostrar os credores e as dívidas demonstrativas.");
      } else if (result.conversation.identityStatus === "BLOCKED") {
        setChallenge(null);
        bot("O limite de três tentativas foi atingido. A sessão foi bloqueada e nenhuma dívida foi revelada.");
      } else {
        const current = await getChallenge(conversation.id);
        setChallenge(current.challenge);
        bot(`Resposta não validada. Restam ${result.attemptsRemaining} tentativa(s).`);
      }
    });
  }

  async function chooseDebt(debtRef: string, description: string) {
    if (!conversation) return;
    user(`Ver dívida: ${description}`);
    await run(async () => {
      const [{ debt: selected }, available] = await Promise.all([
        getDebt(conversation.id, debtRef), listOffers(conversation.id, debtRef),
      ]);
      setDebt(selected);
      setOffers(available.offers);
      setOffer(null);
      setAcceptanceId(null);
      setInstrument(null);
      bot("Confira os valores e vencimentos exibidos. Escolha apenas uma proposta previamente autorizada.");
    });
  }

  async function confirmAcceptance() {
    if (!conversation || !debt || !offer) return;
    user("Confirmo o aceite demonstrativo desta proposta");
    const scope = `chat:accept:${conversation.id}:${debt.debtRef}:${offer.offerRef}`;
    const fingerprint = JSON.stringify({ offerRef: offer.offerRef, providerVersion: offer.providerVersion, terms: offer.terms });
    await run(async () => {
      const result = await acceptOffer({ conversationId: conversation.id, debtRef: debt.debtRef, offer, idempotencyKey: getIntentKey(scope, fingerprint) });
      clearIntentKey(scope);
      setAcceptanceId(result.acceptance.id);
      bot("Aceite demonstrativo registrado. Isso não representa pagamento nem quitação.");
    });
  }

  async function makeInstrument(type: "DEMO_LINK" | "DEMO_BOLETO" | "DEMO_PIX") {
    if (!conversation || !acceptanceId) return;
    const scope = `chat:instrument:${conversation.id}:${acceptanceId}:${type}`;
    await run(async () => {
      const result = await createInstrument({ conversationId: conversation.id, acceptanceId, type, idempotencyKey: getIntentKey(scope, type) });
      clearIntentKey(scope);
      setInstrument(`${result.instrument.warning}\n${result.instrument.displayValue}`);
      bot("Instrumento demonstrativo gerado somente como texto. Ele é tecnicamente não pagável.");
    });
  }

  async function promise(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || !debt) return;
    const data = new FormData(event.currentTarget);
    const promisedDate = String(data.get("promisedDate"));
    const scope = `chat:promise:${conversation.id}:${debt.debtRef}`;
    const fingerprint = JSON.stringify({ promisedDate, offerRef: offer?.offerRef });
    await run(async () => {
      const result = await registerPromise({ conversationId: conversation.id, debtRef: debt.debtRef, promisedDate, offerRef: offer?.offerRef, idempotencyKey: getIntentKey(scope, fingerprint) });
      clearIntentKey(scope);
      bot(`Promessa registrada para ${formatDate(result.promise.promisedDate)}. É uma intenção futura, não um pagamento ou quitação.`);
    });
  }

  async function paymentReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || !debt) return;
    const local = String(new FormData(event.currentTarget).get("reportedAt"));
    const reportedAt = new Date(local).toISOString();
    const scope = `chat:report:${conversation.id}:${debt.debtRef}`;
    await run(async () => {
      const result = await reportPayment({ conversationId: conversation.id, debtRef: debt.debtRef, reportedAt, idempotencyKey: getIntentKey(scope, reportedAt) });
      clearIntentKey(scope);
      bot(`Pagamento apenas informado, situação ${result.report.status}. Não há confirmação real nem quitação automática.`);
    });
  }

  async function dispute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || !debt) return;
    const form = new FormData(event.currentTarget);
    const reasonCode = String(form.get("reasonCode"));
    const description = String(form.get("description") ?? "").trim();
    const scope = `chat:dispute:${conversation.id}:${debt.debtRef}`;
    const fingerprint = JSON.stringify({ reasonCode, description });
    await run(async () => {
      const result = await openDispute({ conversationId: conversation.id, debtRef: debt.debtRef, reasonCode, description: description || undefined, idempotencyKey: getIntentKey(scope, fingerprint) });
      clearIntentKey(scope);
      bot(`Contestação ${result.dispute.status}. Ela depende de análise e nenhuma decisão foi tomada automaticamente.`);
    });
  }

  async function terminalAction(kind: Exclude<TerminalConfirmation, null>) {
    if (!conversation) return;
    await run(async () => {
      const result = kind === "opt-out" ? await optOutConversation(conversation.id) : await closeConversation(conversation.id);
      setConversation(result.conversation);
      setTerminalConfirmation(null);
      bot(kind === "opt-out" ? "As mensagens foram interrompidas. Nenhuma negociação adicional será permitida." : "Conversa encerrada. Ela não será reaberta automaticamente.");
    });
  }

  async function submitText(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const text = composerText;
    if (!text.trim()) return;
    user(text);
    setComposerText("");
    if (!conversation) return;
    setBusy(true);
    try {
      const uiContext = conversation.identityStatus !== "VERIFIED"
        ? "IDENTITY"
        : !debt
          ? "DEBT_LIST"
          : acceptanceId
            ? "ACCEPTED"
            : offer
              ? "OFFER_REVIEW"
              : "DEBT_DETAIL";
      const result = await interpretConversationTurn({
        conversationId: conversation.id,
        message: text,
        clientTurnId: crypto.randomUUID(),
        uiContext,
        ...(debt ? { selectedDebtRef: debt.debtRef } : {}),
        ...(offer ? { selectedOfferRef: offer.offerRef } : {}),
      });
      bot(result.turn.message);
    } catch {
      const intent = interpretSafeChatText(text);
      bot(intent === "HELP" ? "Use os botões para avançar com segurança. Texto livre nunca confirma uma operação."
        : intent === "LIST_DEBTS" && conversation.identityStatus === "VERIFIED" ? "As dívidas disponíveis estão nos botões abaixo."
          : intent === "LIST_OFFERS" && debt ? "As propostas autorizadas estão nos botões abaixo."
            : "Não entendi com segurança. Escolha uma das opções exibidas; nenhuma ação foi executada.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="chat-page">
      <header className="chat-header">
        <a className="brand" href={`/demo/${encodeURIComponent(slug)}`}><span className="brand-mark" aria-hidden="true">E</span><span>ENKI <strong>Collections</strong></span></a>
        <span className="chat-demo-chip">Demonstração · sem valor financeiro</span>
      </header>
      <section className="chat-shell" aria-label="Webchat demonstrativo">
        <div className="chat-title"><a className="chat-back" aria-label="Voltar ao início" href={`/demo/${encodeURIComponent(slug)}`}>←</a><span className="assistant-avatar" aria-hidden="true">E</span><div><h1>Assistente ENKI</h1><p><span className="status-dot" />Atendimento digital</p></div>
          <div className="chat-header-actions"><button className="chat-stop" disabled={!conversation || terminal || busy} onClick={() => setTerminalConfirmation("opt-out")}>Interromper mensagens</button><button className="chat-menu" aria-label="Encerrar conversa" disabled={!conversation || terminal || busy} onClick={() => setTerminalConfirmation("close")}>•••</button></div>
        </div>
        <div className="chat-log" role="log" aria-live="polite" aria-relevant="additions">
          {messages.map((message) => <div className={`chat-bubble ${message.actor}`} key={message.id}><span>{message.actor === "bot" ? "ENKI demo" : "Você"}</span><p>{message.text}</p></div>)}
          {error && <div className="alert error" role="alert">{error}</div>}
          {busy && <div className="typing" role="status"><span aria-hidden="true"><i /><i /><i /></span>Assistente está digitando…</div>}
          <div ref={logEnd} />
        </div>
        <div className="chat-actions">
          {!conversation && <button className="button primary" onClick={start} disabled={busy}>Iniciar conversa</button>}
          {conversation && !terminal && conversation.identityStatus === "NOT_STARTED" && <form className="chat-form" onSubmit={submitIdentifier}><label htmlFor="chatIdentifier">Identificador DEMO-*</label><input id="chatIdentifier" value={identifier} onChange={(event) => setIdentifier(event.target.value.toUpperCase())} pattern="DEMO-[A-Z0-9]{2,16}-[A-Z0-9]{3,8}" maxLength={48} required /><button className="button primary" disabled={busy}>Enviar identificador fictício</button></form>}
          {conversation && !terminal && conversation.identityStatus === "PENDING" && challenge && <fieldset><legend>{challenge.prompt} · {challenge.attemptsRemaining} tentativa(s)</legend><div className="quick-replies">{challenge.options.map((option) => <button className="button secondary" key={option.optionRef} disabled={busy} onClick={() => chooseChallenge(option.optionRef, option.label)}>{option.label}</button>)}</div></fieldset>}
          {conversation?.identityStatus === "BLOCKED" && !terminal && <p className="terminal-note" role="alert">Sessão bloqueada após três falhas. Nenhuma dívida foi revelada.</p>}
          {conversation?.identityStatus === "VERIFIED" && !terminal && !debt && <div><h2>Escolha uma dívida fictícia</h2>{creditors.map((creditor) => <section className="chat-group" key={creditor.creditorRef}><h3>{creditor.displayName}</h3>{creditor.debts.map((item) => <button className="chat-option" key={item.debtRef} onClick={() => chooseDebt(item.debtRef, item.description)}><span>{item.description} · vence {formatDate(item.dueDate)}</span><strong>{formatMoney(item.amount.amountInCents)}</strong></button>)}</section>)}</div>}
          {conversation?.identityStatus === "VERIFIED" && !terminal && debt && <div className="chat-negotiation"><button className="text-button" onClick={() => { setDebt(null); setOffer(null); setOffers([]); }}>← Voltar às dívidas</button><div className="selected-debt"><span>{debt.creditor.displayName}</span><strong>{debt.description}</strong><p>{formatMoney(debt.amount.amountInCents)} · vence {formatDate(debt.dueDate)}</p></div><h3>Propostas autorizadas</h3>{offers.map((item) => <button className="chat-option" key={item.offerRef} disabled={item.status !== "AVAILABLE"} onClick={() => setOffer(item)}><span>{item.terms.kind === "CASH" ? "À vista" : `${item.terms.installmentCount} parcelas`} · primeiro vencimento {formatDate(item.terms.firstDueDate)}</span><strong>{formatMoney(item.terms.total.amountInCents)}</strong></button>)}{offer && !acceptanceId && <div className="chat-confirm"><strong>Revisar aceite de {formatMoney(offer.terms.total.amountInCents)}</strong><p>A proposta será validada novamente. Isso não é pagamento.</p><button className="button primary" onClick={confirmAcceptance}>Confirmar aceite demonstrativo</button><button className="button secondary" onClick={() => setOffer(null)}>Cancelar</button></div>}{acceptanceId && <div className="chat-confirm"><span className="demo-seal">DEMONSTRAÇÃO — SEM VALOR FINANCEIRO</span><h3>Instrumento não pagável</h3><div className="quick-replies"><button className="button secondary" onClick={() => makeInstrument("DEMO_LINK")}>Link demo</button><button className="button secondary" onClick={() => makeInstrument("DEMO_BOLETO")}>Boleto demo</button><button className="button secondary" onClick={() => makeInstrument("DEMO_PIX")}>Pix demo</button></div>{instrument && <pre className="chat-instrument">{instrument}</pre>}</div>}<details className="chat-occurrences"><summary>Outras opções</summary><div className="chat-operations"><form onSubmit={promise}><h3>Promessa</h3><p>Intenção futura; não é pagamento.</p><label htmlFor="chatPromise">Data</label><input id="chatPromise" name="promisedDate" type="date" required /><button className="button secondary">Confirmar promessa</button></form><form onSubmit={paymentReport}><h3>Pagamento informado</h3><p>Pendente; não confirma quitação.</p><label htmlFor="chatReport">Data e hora declaradas</label><input id="chatReport" name="reportedAt" type="datetime-local" required /><button className="button secondary">Confirmar informação</button></form><form onSubmit={dispute}><h3>Contestação</h3><p>Pendente de análise.</p><label htmlFor="chatReason">Motivo</label><select id="chatReason" name="reasonCode" required defaultValue=""><option value="" disabled>Selecione</option><option value="NOT_RECOGNIZED">Não reconheço</option><option value="AMOUNT_INCORRECT">Valor incorreto</option><option value="ALREADY_PAID">Já informado como pago</option><option value="OTHER">Outro</option></select><label htmlFor="chatDescription">Descrição opcional</label><textarea id="chatDescription" name="description" maxLength={300} rows={2} /><button className="button secondary">Confirmar contestação</button></form></div></details></div>}
          {terminal && <div className="terminal-note" role="status"><strong>{conversation?.state === "OPTED_OUT" ? "Mensagens interrompidas" : "Conversa encerrada"}</strong><p>Este estado é terminal. Inicie uma nova sessão conscientemente para testar novamente.</p><button className="button secondary" onClick={() => { sessionStorage.removeItem(storageKey); location.reload(); }}>Criar nova sessão</button></div>}
          {conversation && !terminal && <form className="chat-text" onSubmit={submitText}><label className="sr-only" htmlFor="chatText">Mensagem</label><div><textarea id="chatText" name="chatText" rows={1} maxLength={160} autoComplete="off" value={composerText} onChange={(event) => { setComposerText(event.target.value); event.currentTarget.style.height = "auto"; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 120)}px`; }} onKeyDown={(event) => { if (shouldSubmitComposerKey(event.key, event.shiftKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Digite sua mensagem…" /><button className="chat-send" aria-label="Enviar mensagem" disabled={busy || !composerText.trim()}><span aria-hidden="true">→</span></button></div><small>Uma mensagem nunca confirma operações sem sua ação explícita.</small></form>}
          {terminalConfirmation && <div className="terminal-confirm" role="dialog" aria-modal="true" aria-labelledby="terminal-title"><h2 id="terminal-title">{terminalConfirmation === "opt-out" ? "Interromper todas as mensagens?" : "Encerrar esta conversa?"}</h2><p>Esta ação é terminal e não reabre a conversa.</p><button autoFocus className="button primary" onClick={() => terminalAction(terminalConfirmation)}>Confirmar</button><button className="button secondary" onClick={() => setTerminalConfirmation(null)}>Voltar</button></div>}
        </div>
      </section>
      <footer className="chat-footer"><strong>DEMONSTRAÇÃO — SEM VALOR FINANCEIRO</strong><span>ENKI Collections · v{version}</span></footer>
    </main>
  );
}
