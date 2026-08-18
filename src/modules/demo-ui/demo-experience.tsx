"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  acceptOffer, closeConversation, createConversation, createInstrument, DemoApiError,
  getChallenge, getConversation, getDebt, identify, listDebts, listOffers, openDispute,
  optOutConversation, registerPromise, reportPayment, verifyIdentity,
  type Conversation, type CreditorGroup, type Debt, type Offer, type PublicChallenge,
} from "./demo-api";
import { GuidedAssistant } from "./guided-assistant";
import { clearIntentKey, getIntentKey } from "./idempotency-client";

type Receipt = Readonly<{ title: string; lines: readonly string[] }>;
type JourneyView = "DETAIL" | "OFFERS" | "REVIEW";
type TerminalChoice = "CLOSE" | "OPT_OUT" | null;

const moneyFormatter = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatMoney = (cents: number) => moneyFormatter.format(cents / 100);
const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" })
  .format(new Date(`${value.slice(0, 10)}T12:00:00.000Z`));

function safeError(error: unknown) {
  if (error instanceof DemoApiError) return error.status === 429
    ? "Muitas tentativas. Aguarde um pouco e tente novamente."
    : error.status >= 500 ? "A demonstração está indisponível no momento. Tente novamente em instantes." : error.message;
  return "Não foi possível concluir esta etapa. Tente novamente.";
}

export function DemoExperience({ slug, version }: { slug: string; version: string }) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [challenge, setChallenge] = useState<PublicChallenge | null>(null);
  const [creditors, setCreditors] = useState<readonly CreditorGroup[]>([]);
  const [selectedDebt, setSelectedDebt] = useState<(Debt & { creditor?: { displayName: string } }) | null>(null);
  const [offers, setOffers] = useState<readonly Offer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [acceptanceId, setAcceptanceId] = useState<string | null>(null);
  const [instrument, setInstrument] = useState<{ type: string; displayValue: string; expiresAt: string; warning: string } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("DEMO-AURORA-001");
  const [selectedOption, setSelectedOption] = useState("");
  const [journeyView, setJourneyView] = useState<JourneyView>("DETAIL");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [humanRequested, setHumanRequested] = useState(false);
  const [terminalChoice, setTerminalChoice] = useState<TerminalChoice>(null);
  const terminal = conversation?.state === "CLOSED" || conversation?.state === "OPTED_OUT";
  const storageKey = `enki-demo:conversation:${slug}`;

  const loadDebts = useCallback(async (conversationId: string) => {
    setCreditors((await listDebts(conversationId)).creditors);
  }, []);

  useEffect(() => {
    const reference = sessionStorage.getItem(storageKey);
    if (!reference) { queueMicrotask(() => setBusy(false)); return; }
    getConversation(reference).then(async ({ conversation: restored }) => {
      setConversation(restored);
      if (restored.state === "CLOSED" || restored.state === "OPTED_OUT") return;
      if (restored.identityStatus === "PENDING") setChallenge((await getChallenge(restored.id)).challenge);
      if (restored.identityStatus === "VERIFIED") await loadDebts(restored.id);
    }).catch(() => {
      sessionStorage.removeItem(storageKey);
      setError("A sessão anterior expirou. Inicie uma nova demonstração.");
    }).finally(() => setBusy(false));
  }, [loadDebts, storageKey]);

  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(null);
    try { await action(); } catch (caught) { setError(safeError(caught)); } finally { setBusy(false); }
  }

  async function start() {
    await run(async () => {
      const result = await createConversation(slug);
      setConversation(result.conversation); sessionStorage.setItem(storageKey, result.conversation.id);
      setChallenge(null); setCreditors([]); setSelectedDebt(null); setSelectedOffer(null); setJourneyView("DETAIL"); setReceipt(null);
    });
  }

  async function submitIdentifier(event: React.FormEvent) {
    event.preventDefault(); if (!conversation) return;
    await run(async () => {
      const result = await identify(conversation.id, identifier);
      setConversation(result.conversation); setChallenge(result.verificationRequired ? result.challenge : null); setSelectedOption("");
    });
  }

  async function submitChallenge(event: React.FormEvent) {
    event.preventDefault(); if (!conversation || !selectedOption) return;
    await run(async () => {
      const result = await verifyIdentity(conversation.id, selectedOption);
      setConversation(result.conversation); setSelectedOption("");
      if (result.verified) { setChallenge(null); await loadDebts(conversation.id); }
      else if (result.conversation.identityStatus === "BLOCKED") setChallenge(null);
      else setChallenge((await getChallenge(conversation.id)).challenge);
    });
  }

  async function selectDebt(debtRef: string) {
    if (!conversation) return;
    await run(async () => {
      const [{ debt }, available] = await Promise.all([getDebt(conversation.id, debtRef), listOffers(conversation.id, debtRef)]);
      setSelectedDebt(debt); setOffers(available.offers); setSelectedOffer(null); setJourneyView("DETAIL"); setInstrument(null); setReceipt(null);
      setAcceptanceId(sessionStorage.getItem(`enki-demo:acceptance:${conversation.id}:${debtRef}`));
    });
  }

  async function confirmAcceptance() {
    if (!conversation || !selectedDebt || !selectedOffer) return;
    const scope = `accept:${conversation.id}:${selectedDebt.debtRef}:${selectedOffer.offerRef}`;
    const fingerprint = JSON.stringify({ offerRef: selectedOffer.offerRef, providerVersion: selectedOffer.providerVersion, terms: selectedOffer.terms });
    await run(async () => {
      const result = await acceptOffer({ conversationId: conversation.id, debtRef: selectedDebt.debtRef, offer: selectedOffer, idempotencyKey: getIntentKey(scope, fingerprint) });
      clearIntentKey(scope); setAcceptanceId(result.acceptance.id);
      sessionStorage.setItem(`enki-demo:acceptance:${conversation.id}:${selectedDebt.debtRef}`, result.acceptance.id);
      setReceipt({ title: "Proposta demonstrativa confirmada", lines: ["O aceite foi registrado.", "Isso não representa pagamento ou quitação."] });
    });
  }

  async function requestInstrument(type: "DEMO_LINK" | "DEMO_BOLETO" | "DEMO_PIX") {
    if (!conversation || !acceptanceId) return;
    const scope = `instrument:${conversation.id}:${acceptanceId}:${type}`;
    await run(async () => {
      const result = await createInstrument({ conversationId: conversation.id, acceptanceId, type, idempotencyKey: getIntentKey(scope, type) });
      clearIntentKey(scope); setInstrument(result.instrument);
    });
  }

  async function submitPromise(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!conversation || !selectedDebt) return;
    const promisedDate = String(new FormData(event.currentTarget).get("promisedDate"));
    const scope = `promise:${conversation.id}:${selectedDebt.debtRef}`;
    const fingerprint = JSON.stringify({ promisedDate, offerRef: selectedOffer?.offerRef });
    await run(async () => {
      const result = await registerPromise({ conversationId: conversation.id, debtRef: selectedDebt.debtRef, promisedDate, offerRef: selectedOffer?.offerRef, idempotencyKey: getIntentKey(scope, fingerprint) });
      clearIntentKey(scope); setReceipt({ title: "Promessa registrada", lines: [`Data declarada: ${formatDate(result.promise.promisedDate)}`, "Isso não representa pagamento."] });
    });
  }

  async function submitReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!conversation || !selectedDebt) return;
    const reportedAt = new Date(String(new FormData(event.currentTarget).get("reportedAt"))).toISOString();
    const scope = `report:${conversation.id}:${selectedDebt.debtRef}`;
    await run(async () => {
      const result = await reportPayment({ conversationId: conversation.id, debtRef: selectedDebt.debtRef, reportedAt, idempotencyKey: getIntentKey(scope, reportedAt) });
      clearIntentKey(scope); setReceipt({ title: "Pagamento informado", lines: [result.report.warning, "A informação permanece pendente de análise."] });
    });
  }

  async function submitDispute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!conversation || !selectedDebt) return;
    const data = new FormData(event.currentTarget); const reasonCode = String(data.get("reasonCode")); const description = String(data.get("description") ?? "").trim();
    const scope = `dispute:${conversation.id}:${selectedDebt.debtRef}`; const fingerprint = JSON.stringify({ reasonCode, description });
    await run(async () => {
      const result = await openDispute({ conversationId: conversation.id, debtRef: selectedDebt.debtRef, reasonCode, description: description || undefined, idempotencyKey: getIntentKey(scope, fingerprint) });
      clearIntentKey(scope); setReceipt({ title: "Contestação registrada", lines: [`Situação: ${result.dispute.status}.`, "A solicitação depende de análise."] });
    });
  }

  async function finishConversation(choice: Exclude<TerminalChoice, null>) {
    if (!conversation) return;
    await run(async () => {
      const result = choice === "OPT_OUT" ? await optOutConversation(conversation.id) : await closeConversation(conversation.id);
      setConversation(result.conversation); setTerminalChoice(null);
    });
  }

  const progress = useMemo(() => {
    if (!conversation) return { current: 1, label: "Boas-vindas" };
    if (conversation.identityStatus === "NOT_STARTED") return { current: 2, label: "Identificação" };
    if (conversation.identityStatus === "PENDING") return { current: 3, label: "Validação" };
    if (!selectedDebt) return { current: 4, label: "Escolha da dívida" };
    if (acceptanceId) return { current: 8, label: "Próximos passos" };
    if (journeyView === "DETAIL") return { current: 5, label: "Detalhes" };
    if (journeyView === "OFFERS") return { current: 6, label: "Propostas" };
    return { current: 7, label: "Revisão" };
  }, [acceptanceId, conversation, journeyView, selectedDebt]);

  const assistantContext = !conversation || conversation.identityStatus !== "VERIFIED" ? "IDENTITY"
    : !selectedDebt ? "DEBT_LIST" : acceptanceId ? "ACCEPTED" : selectedOffer ? "OFFER_REVIEW" : "DEBT_DETAIL";

  function goBack() {
    if (journeyView === "REVIEW") { setJourneyView("OFFERS"); return; }
    if (journeyView === "OFFERS") { setJourneyView("DETAIL"); return; }
    setSelectedDebt(null); setSelectedOffer(null); setReceipt(null);
  }

  return (
    <main className="guided-page">
      <header className="guided-header"><a className="brand" href={`/demo/${encodeURIComponent(slug)}`}><span className="brand-mark" aria-hidden="true">E</span><span>ENKI <strong>Collections</strong></span></a><span>Demonstração · sem valor financeiro</span></header>
      <div className="guided-layout">
        <section className="journey-shell" aria-label="Jornada de negociação demonstrativa">
          <div className="journey-progress"><span>Etapa {progress.current} de 8</span><strong>{progress.label}</strong><div><i style={{ width: `${progress.current * 12.5}%` }} /></div></div>
          {error && <div className="journey-alert" role="alert"><strong>Não foi possível continuar</strong><p>{error}</p></div>}
          {busy && <div className="journey-loading" role="status">Carregando esta etapa…</div>}

          {!conversation && <section className="journey-card welcome-step"><p className="journey-kicker">Bem-vindo à ENKI</p><h1>Resolva tudo em etapas simples.</h1><p>Consulte uma dívida fictícia, veja propostas autorizadas e escolha como deseja continuar. Nenhum pagamento real será realizado.</p><div className="demo-identifier"><span>Identificador para teste</span><strong>DEMO-AURORA-001</strong></div><button className="journey-primary" disabled={busy} onClick={() => void start()}>Começar demonstração</button></section>}

          {conversation && terminal && <section className="journey-card"><h1>{conversation.state === "OPTED_OUT" ? "Mensagens interrompidas" : "Atendimento encerrado"}</h1><p>Esta sessão foi finalizada e nenhuma nova negociação pode ser realizada nela.</p><button className="journey-secondary" onClick={() => { sessionStorage.removeItem(storageKey); location.reload(); }}>Iniciar uma nova sessão</button></section>}

          {conversation?.identityStatus === "NOT_STARTED" && !terminal && <section className="journey-card"><p className="journey-kicker">Identificação fictícia</p><h1>Informe seu identificador demonstrativo</h1><p>Não use CPF, telefone, e-mail ou qualquer dado pessoal real.</p><form className="journey-form" onSubmit={submitIdentifier}><label htmlFor="demoIdentifier">Identificador</label><input id="demoIdentifier" value={identifier} onChange={(event) => setIdentifier(event.target.value.toUpperCase())} pattern="DEMO-[A-Z0-9]{2,16}-[A-Z0-9]{3,8}" maxLength={48} required /><button className="journey-primary" disabled={busy}>Continuar</button></form></section>}

          {conversation?.identityStatus === "PENDING" && challenge && !terminal && <section className="journey-card"><p className="journey-kicker">Validação simulada</p><h1>{challenge.prompt}</h1><p>Escolha uma resposta. Restam {challenge.attemptsRemaining} tentativa(s).</p><form className="journey-form" onSubmit={submitChallenge}><fieldset><legend>Opções de resposta</legend>{challenge.options.map((option) => <label className="journey-choice" key={option.optionRef}><input type="radio" name="challenge" checked={selectedOption === option.optionRef} onChange={() => setSelectedOption(option.optionRef)} /><span>{option.label}</span></label>)}</fieldset><button className="journey-primary" disabled={busy || !selectedOption}>Validar identidade</button></form></section>}

          {conversation?.identityStatus === "BLOCKED" && !terminal && <section className="journey-card"><h1>Validação bloqueada</h1><p>O limite de tentativas foi atingido. Nenhuma dívida foi exibida.</p></section>}

          {conversation?.identityStatus === "VERIFIED" && !selectedDebt && !terminal && <section className="journey-card"><p className="journey-kicker">Identidade validada</p><h1>Escolha uma dívida</h1><p>Veja apenas o essencial. Os detalhes aparecem na próxima etapa.</p><div className="debt-list">{creditors.flatMap((creditor) => creditor.debts.map((debt) => <article className="guided-debt" key={debt.debtRef}><span>{creditor.displayName}</span><h2>{debt.description}</h2><dl><div><dt>Valor</dt><dd>{formatMoney(debt.amount.amountInCents)}</dd></div><div><dt>Vencimento</dt><dd>{formatDate(debt.dueDate)}</dd></div><div><dt>Situação</dt><dd>{debt.status === "OPEN" ? "Em aberto" : debt.status}</dd></div></dl><button className="journey-primary" disabled={busy} onClick={() => void selectDebt(debt.debtRef)}>Ver opções</button></article>))}{creditors.length === 0 && <p>Nenhuma dívida demonstrativa disponível.</p>}</div></section>}

          {conversation?.identityStatus === "VERIFIED" && selectedDebt && journeyView === "DETAIL" && !terminal && <section className="journey-card"><button className="journey-back" onClick={goBack}>← Voltar</button><p className="journey-kicker">Detalhes da dívida</p><h1>{selectedDebt.description}</h1><div className="debt-summary"><span>{selectedDebt.creditor?.displayName}</span><strong>{formatMoney(selectedDebt.amount.amountInCents)}</strong><p>Vencimento em {formatDate(selectedDebt.dueDate)} · Situação em aberto</p></div><p>Confira as informações antes de ver as propostas autorizadas.</p><button className="journey-primary" onClick={() => setJourneyView("OFFERS")}>Ver propostas</button></section>}

          {conversation?.identityStatus === "VERIFIED" && selectedDebt && journeyView === "OFFERS" && !acceptanceId && !terminal && <section className="journey-card"><button className="journey-back" onClick={goBack}>← Voltar</button><p className="journey-kicker">Propostas autorizadas</p><h1>Escolha uma proposta</h1><p>Compare as condições disponíveis. A ENKI não recomenda uma opção como melhor.</p><div className="guided-offers">{offers.map((offer) => <article className="guided-offer" key={offer.offerRef}><span>{offer.terms.kind === "CASH" ? "À vista" : "Parcelada"}</span><strong>{formatMoney(offer.terms.total.amountInCents)}</strong><dl><div><dt>Entrada</dt><dd>{formatMoney(offer.terms.downPayment.amountInCents)}</dd></div><div><dt>Parcelas</dt><dd>{offer.terms.installmentCount} de {formatMoney(offer.terms.installmentAmount.amountInCents)}</dd></div><div><dt>Primeiro vencimento</dt><dd>{formatDate(offer.terms.firstDueDate)}</dd></div><div><dt>Validade</dt><dd>{formatDate(offer.expiresAt)}</dd></div></dl><button className="journey-primary" disabled={busy || offer.status !== "AVAILABLE"} onClick={() => { setSelectedOffer(offer); setJourneyView("REVIEW"); }}>Escolher esta proposta</button></article>)}</div></section>}

          {conversation?.identityStatus === "VERIFIED" && selectedDebt && selectedOffer && journeyView === "REVIEW" && !acceptanceId && !terminal && <section className="journey-card"><button className="journey-back" onClick={goBack}>← Voltar</button><p className="journey-kicker">Revisão</p><h1>Revise antes de confirmar</h1><div className="review-summary"><div><span>Dívida</span><strong>{selectedDebt.description}</strong></div><div><span>Credor</span><strong>{selectedDebt.creditor?.displayName}</strong></div><div><span>Proposta</span><strong>{selectedOffer.terms.kind === "CASH" ? "À vista" : "Parcelada"} · {formatMoney(selectedOffer.terms.total.amountInCents)}</strong></div><div><span>Entrada</span><strong>{formatMoney(selectedOffer.terms.downPayment.amountInCents)}</strong></div><div><span>Parcelas</span><strong>{selectedOffer.terms.installmentCount} de {formatMoney(selectedOffer.terms.installmentAmount.amountInCents)}</strong></div><div><span>Primeiro vencimento</span><strong>{formatDate(selectedOffer.terms.firstDueDate)}</strong></div></div><div className="demo-warning"><strong>DEMONSTRAÇÃO — SEM VALOR FINANCEIRO</strong><p>Confirmar registra apenas um aceite fictício. Não ocorre pagamento nem quitação.</p></div><button className="journey-primary" disabled={busy} onClick={() => void confirmAcceptance()}>Confirmar proposta</button><button className="journey-secondary" onClick={goBack}>Voltar</button></section>}

          {acceptanceId && selectedDebt && <section className="journey-card"><p className="journey-kicker">Próximos passos</p><h1>Proposta confirmada</h1><p>O aceite demonstrativo foi registrado. Agora você pode visualizar um instrumento fictício, sem possibilidade de pagamento.</p>{receipt && <div className="journey-success" role="status"><strong>{receipt.title}</strong>{receipt.lines.map((line) => <p key={line}>{line}</p>)}</div>}<div className="instrument-actions"><button className="journey-primary" onClick={() => void requestInstrument("DEMO_LINK")}>Gerar link demonstrativo</button><button className="journey-secondary" onClick={() => void requestInstrument("DEMO_BOLETO")}>Ver boleto fictício</button><button className="journey-secondary" onClick={() => void requestInstrument("DEMO_PIX")}>Ver Pix fictício</button></div>{instrument && <div className="guided-instrument"><strong>{instrument.warning}</strong><pre>{instrument.displayValue}</pre><p>Conteúdo apenas em texto. Não é pagável nem executável.</p></div>}</section>}

          {selectedDebt && !terminal && <details className="other-options"><summary>Outras opções</summary><div><form onSubmit={submitPromise}><h2>Promessa de pagamento</h2><p>Registre uma intenção futura. Não é pagamento.</p><label htmlFor="promisedDate">Data prometida</label><input id="promisedDate" name="promisedDate" type="date" required /><button disabled={busy}>Registrar promessa</button></form><form onSubmit={submitReport}><h2>Informar pagamento</h2><p>A informação ficará pendente de análise.</p><label htmlFor="reportedAt">Data e hora informadas</label><input id="reportedAt" name="reportedAt" type="datetime-local" required /><button disabled={busy}>Informar pagamento</button></form><form onSubmit={submitDispute}><h2>Contestar dívida</h2><p>A contestação não será decidida automaticamente.</p><label htmlFor="reasonCode">Motivo</label><select id="reasonCode" name="reasonCode" defaultValue="" required><option value="" disabled>Selecione</option><option value="NOT_RECOGNIZED">Não reconheço</option><option value="AMOUNT_INCORRECT">Valor incorreto</option><option value="ALREADY_PAID">Já informei pagamento</option><option value="OTHER">Outro</option></select><label htmlFor="description">Descrição opcional</label><textarea id="description" name="description" maxLength={300} rows={2} /><button disabled={busy}>Registrar contestação</button></form></div></details>}

          {humanRequested && <div className="human-note" role="status"><strong>Solicitação anotada nesta sessão demonstrativa.</strong><p>Ainda não existe integração com atendimento humano e nenhuma transferência real foi iniciada.</p></div>}
          {conversation && !terminal && <div className="journey-utilities"><button onClick={() => setAssistantOpen(true)}>Tirar dúvidas com assistente virtual</button><button onClick={() => setHumanRequested(true)}>Solicitar atendimento humano</button><button onClick={() => setTerminalChoice("OPT_OUT")}>Interromper mensagens</button><button onClick={() => setTerminalChoice("CLOSE")}>Encerrar atendimento</button></div>}
          <footer>Ambiente demonstrativo · dados fictícios · v{version}</footer>
        </section>

        <GuidedAssistant open={assistantOpen} onClose={() => setAssistantOpen(false)} conversation={conversation} selectedDebtRef={selectedDebt?.debtRef} selectedOfferRef={selectedOffer?.offerRef} uiContext={assistantContext} />
      </div>
      {terminalChoice && <div className="guided-dialog" role="dialog" aria-modal="true" aria-labelledby="terminal-heading"><div><h2 id="terminal-heading">{terminalChoice === "OPT_OUT" ? "Interromper mensagens?" : "Encerrar atendimento?"}</h2><p>Esta ação encerra a sessão e não pode ser desfeita.</p><button autoFocus className="journey-primary" onClick={() => void finishConversation(terminalChoice)}>Confirmar</button><button className="journey-secondary" onClick={() => setTerminalChoice(null)}>Voltar</button></div></div>}
      <button className="assistant-launcher" disabled={!conversation || terminal} onClick={() => setAssistantOpen(true)}>Tirar dúvidas</button>
    </main>
  );
}
