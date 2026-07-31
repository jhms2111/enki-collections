"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  acceptOffer,
  createConversation,
  createInstrument,
  DemoApiError,
  getChallenge,
  getConversation,
  getDebt,
  identify,
  listDebts,
  listOffers,
  openDispute,
  registerPromise,
  reportPayment,
  verifyIdentity,
  type Conversation,
  type CreditorGroup,
  type Debt,
  type Offer,
  type PublicChallenge,
} from "./demo-api";
import { clearIntentKey, getIntentKey } from "./idempotency-client";

type Receipt = Readonly<{ title: string; lines: readonly string[] }>;

const moneyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

function formatMoney(amountInCents: number) {
  return moneyFormatter.format(amountInCents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T12:00:00.000Z`));
}

function safeError(error: unknown) {
  if (error instanceof DemoApiError) {
    return `${error.message}${error.requestId ? ` Referência: ${error.requestId}` : ""}`;
  }
  return "Não foi possível concluir a solicitação. Tente novamente.";
}

export function DemoExperience({
  slug,
  version,
}: {
  slug: string;
  version: string;
}) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [challenge, setChallenge] = useState<PublicChallenge | null>(null);
  const [creditors, setCreditors] = useState<readonly CreditorGroup[]>([]);
  const [selectedDebt, setSelectedDebt] = useState<
    (Debt & { creditor?: { displayName: string } }) | null
  >(null);
  const [offers, setOffers] = useState<readonly Offer[]>([]);
  const [selectedOffer, setSelectedOffer] = useState<Offer | null>(null);
  const [acceptanceId, setAcceptanceId] = useState<string | null>(null);
  const [instrument, setInstrument] = useState<{
    type: string;
    displayValue: string;
    expiresAt: string;
    warning: string;
  } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [identifier, setIdentifier] = useState("DEMO-AURORA-001");
  const [selectedOption, setSelectedOption] = useState("");

  const conversationStorageKey = `enki-demo:conversation:${slug}`;

  const loadDebts = useCallback(async (conversationId: string) => {
    const result = await listDebts(conversationId);
    setCreditors(result.creditors);
  }, []);

  useEffect(() => {
    const reference = sessionStorage.getItem(conversationStorageKey);
    if (!reference) {
      queueMicrotask(() => setBusy(false));
      return;
    }
    getConversation(reference)
      .then(async ({ conversation: restored }) => {
        setConversation(restored);
        if (restored.identityStatus === "PENDING") {
          const current = await getChallenge(restored.id);
          setChallenge(current.challenge);
        } else if (restored.identityStatus === "VERIFIED") {
          await loadDebts(restored.id);
        }
      })
      .catch(() => {
        sessionStorage.removeItem(conversationStorageKey);
        setError("A sessão anterior não está mais disponível. Inicie uma nova demonstração.");
      })
      .finally(() => setBusy(false));
  }, [conversationStorageKey, loadDebts]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(safeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function terminalIntent(scope: string) {
    clearIntentKey(scope);
  }

  async function start() {
    await run(async () => {
      const result = await createConversation(slug);
      setConversation(result.conversation);
      sessionStorage.setItem(conversationStorageKey, result.conversation.id);
      setChallenge(null);
      setCreditors([]);
      setSelectedDebt(null);
      setOffers([]);
      setReceipt(null);
    });
  }

  async function submitIdentifier(event: React.FormEvent) {
    event.preventDefault();
    if (!conversation) return;
    await run(async () => {
      const result = await identify(conversation.id, identifier);
      setConversation(result.conversation);
      setChallenge(result.challenge);
      setSelectedOption("");
    });
  }

  async function submitChallenge(event: React.FormEvent) {
    event.preventDefault();
    if (!conversation || !selectedOption) return;
    await run(async () => {
      const result = await verifyIdentity(conversation.id, selectedOption);
      setConversation(result.conversation);
      setSelectedOption("");
      if (result.verified) {
        setChallenge(null);
        await loadDebts(conversation.id);
      } else if (result.conversation.identityStatus === "BLOCKED") {
        setChallenge(null);
      } else {
        const current = await getChallenge(conversation.id);
        setChallenge(current.challenge);
      }
    });
  }

  async function selectDebt(debtRef: string) {
    if (!conversation) return;
    await run(async () => {
      const [{ debt }, offerResult] = await Promise.all([
        getDebt(conversation.id, debtRef),
        listOffers(conversation.id, debtRef),
      ]);
      setSelectedDebt(debt);
      setOffers(offerResult.offers);
      setSelectedOffer(null);
      setInstrument(null);
      setReceipt(null);
      const savedAcceptance = sessionStorage.getItem(
        `enki-demo:acceptance:${conversation.id}:${debtRef}`,
      );
      setAcceptanceId(savedAcceptance);
    });
  }

  async function confirmAcceptance() {
    if (!conversation || !selectedDebt || !selectedOffer) return;
    const scope = `accept:${conversation.id}:${selectedDebt.debtRef}:${selectedOffer.offerRef}`;
    const fingerprint = JSON.stringify({
      offerRef: selectedOffer.offerRef,
      providerVersion: selectedOffer.providerVersion,
      terms: selectedOffer.terms,
    });
    await run(async () => {
      const result = await acceptOffer({
        conversationId: conversation.id,
        debtRef: selectedDebt.debtRef,
        offer: selectedOffer,
        idempotencyKey: getIntentKey(scope, fingerprint),
      });
      terminalIntent(scope);
      setAcceptanceId(result.acceptance.id);
      sessionStorage.setItem(
        `enki-demo:acceptance:${conversation.id}:${selectedDebt.debtRef}`,
        result.acceptance.id,
      );
      setReceipt({
        title: "Proposta demonstrativa aceita",
        lines: [
          `Referência: ${result.acceptance.id}`,
          "Este aceite não representa pagamento ou quitação.",
        ],
      });
    });
  }

  async function requestInstrument(
    type: "DEMO_LINK" | "DEMO_BOLETO" | "DEMO_PIX",
  ) {
    if (!conversation || !acceptanceId) return;
    const scope = `instrument:${conversation.id}:${acceptanceId}:${type}`;
    await run(async () => {
      const result = await createInstrument({
        conversationId: conversation.id,
        acceptanceId,
        type,
        idempotencyKey: getIntentKey(scope, type),
      });
      terminalIntent(scope);
      setInstrument(result.instrument);
    });
  }

  async function submitPromise(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || !selectedDebt) return;
    const data = new FormData(event.currentTarget);
    const promisedDate = String(data.get("promisedDate"));
    const offerRef = selectedOffer?.offerRef;
    const scope = `promise:${conversation.id}:${selectedDebt.debtRef}`;
    const fingerprint = JSON.stringify({ promisedDate, offerRef });
    await run(async () => {
      const result = await registerPromise({
        conversationId: conversation.id,
        debtRef: selectedDebt.debtRef,
        promisedDate,
        offerRef,
        idempotencyKey: getIntentKey(scope, fingerprint),
      });
      terminalIntent(scope);
      setReceipt({
        title: "Promessa demonstrativa registrada",
        lines: [
          `Data declarada: ${formatDate(result.promise.promisedDate)}`,
          "A promessa não representa pagamento ou quitação.",
        ],
      });
    });
  }

  async function submitReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || !selectedDebt) return;
    const data = new FormData(event.currentTarget);
    const localValue = String(data.get("reportedAt"));
    const reportedAt = new Date(localValue).toISOString();
    const scope = `report:${conversation.id}:${selectedDebt.debtRef}`;
    await run(async () => {
      const result = await reportPayment({
        conversationId: conversation.id,
        debtRef: selectedDebt.debtRef,
        reportedAt,
        idempotencyKey: getIntentKey(scope, reportedAt),
      });
      terminalIntent(scope);
      setReceipt({
        title: "Pagamento apenas informado",
        lines: [
          `Declarado pelo usuário: ${new Date(result.report.reportedAt).toLocaleString("pt-BR")}`,
          `Recebido pelo sistema: ${new Date(result.report.receivedAt).toLocaleString("pt-BR")}`,
          result.report.warning,
        ],
      });
    });
  }

  async function submitDispute(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!conversation || !selectedDebt) return;
    const data = new FormData(event.currentTarget);
    const reasonCode = String(data.get("reasonCode"));
    const description = String(data.get("description") ?? "").trim();
    const scope = `dispute:${conversation.id}:${selectedDebt.debtRef}`;
    const fingerprint = JSON.stringify({ reasonCode, description });
    await run(async () => {
      const result = await openDispute({
        conversationId: conversation.id,
        debtRef: selectedDebt.debtRef,
        reasonCode,
        description: description || undefined,
        idempotencyKey: getIntentKey(scope, fingerprint),
      });
      terminalIntent(scope);
      event.currentTarget.reset();
      setReceipt({
        title: "Contestação registrada para análise",
        lines: [
          `Motivo: ${result.dispute.reasonCode}`,
          "Situação: pendente de análise. Nenhuma decisão foi tomada automaticamente.",
        ],
      });
    });
  }

  const step = useMemo(() => {
    if (!conversation) return 1;
    if (conversation.identityStatus !== "VERIFIED") return 2;
    if (!selectedDebt) return 3;
    return 4;
  }, [conversation, selectedDebt]);

  return (
    <main className="demo-page">
      <div className="demo-ribbon" role="status">
        DEMONSTRAÇÃO · DADOS FICTÍCIOS · SEM VALOR FINANCEIRO
      </div>
      <header className="demo-header">
        <a className="brand" href={`/demo/${encodeURIComponent(slug)}`}>
          <span className="brand-mark" aria-hidden="true">E</span>
          <span>ENKI <strong>Collections</strong></span>
        </a>
        <span className="environment-chip">Ambiente seguro de demonstração</span>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">Jornada digital demonstrativa</p>
          <h1>Negociação clara, segura e sob controle.</h1>
          <p>
            Explore um atendimento fictício de cobrança. Nenhuma ação gera
            pagamento real, Pix válido, boleto pagável ou quitação automática.
          </p>
        </div>
        <div className="trust-card">
          <span aria-hidden="true">✓</span>
          <div><strong>Seus dados reais não são necessários</strong><br />Use apenas os identificadores DEMO.</div>
        </div>
      </section>

      <nav className="stepper" aria-label="Etapas da demonstração">
        {["Início", "Identidade", "Dívidas", "Negociação"].map((label, index) => (
          <div className={step >= index + 1 ? "step active" : "step"} key={label}>
            <span>{index + 1}</span><small>{label}</small>
          </div>
        ))}
      </nav>

      {error && <div className="alert error" role="alert">{error}</div>}
      {busy && <div className="loading" role="status">Processando com segurança…</div>}

      {!conversation && (
        <section className="panel landing-panel">
          <div>
            <p className="eyebrow">Comece por aqui</p>
            <h2>Uma demonstração completa em poucos passos</h2>
            <p>Você verá dívidas e propostas inteiramente fictícias, sempre separadas por credor.</p>
          </div>
          <button className="button primary" onClick={start} disabled={busy}>
            Iniciar demonstração
          </button>
        </section>
      )}

      {conversation?.identityStatus === "NOT_STARTED" && (
        <section className="panel narrow">
          <p className="eyebrow">Identificação fictícia</p>
          <h2>Qual identificador DEMO deseja usar?</h2>
          <p className="muted">Não informe CPF, telefone, e-mail ou qualquer dado pessoal real.</p>
          <form onSubmit={submitIdentifier} className="form-stack">
            <label htmlFor="demoIdentifier">Identificador demonstrativo</label>
            <input id="demoIdentifier" value={identifier} onChange={(e) => setIdentifier(e.target.value)} pattern="DEMO-[A-Z]+-[0-9]{3}" required />
            <button className="button primary" disabled={busy}>Continuar com dados fictícios</button>
          </form>
        </section>
      )}

      {conversation?.identityStatus === "PENDING" && challenge && (
        <section className="panel narrow">
          <p className="eyebrow">Validação simulada</p>
          <h2>{challenge.prompt}</h2>
          <p className="attempts">{challenge.attemptsRemaining} tentativa(s) restante(s)</p>
          <form onSubmit={submitChallenge} className="form-stack">
            <fieldset>
              <legend>Selecione uma opção</legend>
              {challenge.options.map((option) => (
                <label className="choice" key={option.optionRef}>
                  <input type="radio" name="challenge" value={option.optionRef} checked={selectedOption === option.optionRef} onChange={() => setSelectedOption(option.optionRef)} />
                  <span>{option.label}</span>
                </label>
              ))}
            </fieldset>
            <button className="button primary" disabled={busy || !selectedOption}>Validar identidade fictícia</button>
          </form>
        </section>
      )}

      {conversation?.identityStatus === "BLOCKED" && (
        <section className="panel narrow blocked" role="alert">
          <p className="eyebrow">Sessão protegida</p>
          <h2>Validação bloqueada</h2>
          <p>O limite de três tentativas foi atingido. Nenhuma dívida foi revelada.</p>
        </section>
      )}

      {conversation?.identityStatus === "VERIFIED" && !selectedDebt && (
        <section>
          <div className="section-heading">
            <div><p className="eyebrow">Identidade validada</p><h2>Dívidas fictícias por credor</h2></div>
            <span className="safe-badge">✓ Acesso demonstrativo validado</span>
          </div>
          <div className="creditor-grid">
            {creditors.map((creditor) => (
              <article className="creditor-card" key={creditor.creditorRef}>
                <div className="creditor-title"><span aria-hidden="true">◆</span><h3>{creditor.displayName}</h3></div>
                {creditor.debts.map((debt) => (
                  <div className="debt-row" key={debt.debtRef}>
                    <div><strong>{debt.description}</strong><small>Vencimento: {formatDate(debt.dueDate)}</small></div>
                    <div className="debt-value"><strong>{formatMoney(debt.amount.amountInCents)}</strong><button className="button secondary" onClick={() => selectDebt(debt.debtRef)}>Ver opções</button></div>
                  </div>
                ))}
              </article>
            ))}
          </div>
        </section>
      )}

      {conversation?.identityStatus === "VERIFIED" && selectedDebt && (
        <section className="negotiation">
          <button className="back-button" onClick={() => { setSelectedDebt(null); setSelectedOffer(null); setReceipt(null); }}>← Voltar às dívidas</button>
          <div className="detail-header">
            <div><p className="eyebrow">{selectedDebt.creditor?.displayName}</p><h2>{selectedDebt.description}</h2><p>Vencimento: {formatDate(selectedDebt.dueDate)}</p></div>
            <div className="amount-card"><small>Valor informado pelo provider</small><strong>{formatMoney(selectedDebt.amount.amountInCents)}</strong></div>
          </div>

          <h3>Propostas previamente autorizadas</h3>
          <p className="muted">A expiração abaixo é orientação visual. A validação definitiva é sempre feita pelo servidor e pelo provider.</p>
          <div className="offers-grid">
            {offers.map((offer) => (
              <article className={selectedOffer?.offerRef === offer.offerRef ? "offer-card selected" : "offer-card"} key={offer.offerRef}>
                <span className="offer-kind">{offer.terms.kind === "CASH" ? "À vista" : "Parcelado"}</span>
                <strong className="offer-total">{formatMoney(offer.terms.total.amountInCents)}</strong>
                <dl>
                  <div><dt>Entrada</dt><dd>{formatMoney(offer.terms.downPayment.amountInCents)}</dd></div>
                  <div><dt>Parcelas</dt><dd>{offer.terms.installmentCount} × {formatMoney(offer.terms.installmentAmount.amountInCents)}</dd></div>
                  <div><dt>Primeiro vencimento</dt><dd>{formatDate(offer.terms.firstDueDate)}</dd></div>
                </dl>
                <button className="button secondary" disabled={offer.status !== "AVAILABLE"} onClick={() => setSelectedOffer(offer)}>
                  {offer.status === "AVAILABLE" ? "Revisar proposta" : "Proposta expirada"}
                </button>
              </article>
            ))}
          </div>

          {selectedOffer && (
            <section className="review-box">
              <p className="eyebrow">Confirmação consciente</p>
              <h3>Revise antes do aceite demonstrativo</h3>
              <p>Total: <strong>{formatMoney(selectedOffer.terms.total.amountInCents)}</strong>. Nenhum pagamento será realizado agora.</p>
              <button className="button primary" onClick={confirmAcceptance} disabled={busy}>Aceitar proposta demonstrativa</button>
            </section>
          )}

          {acceptanceId && (
            <section className="instrument-box">
              <h3>Gerar instrumento não pagável</h3>
              <p>Escolha apenas para visualizar. Nenhuma opção permite pagamento.</p>
              <div className="button-row">
                <button className="button secondary" onClick={() => requestInstrument("DEMO_LINK")}>Link demo</button>
                <button className="button secondary" onClick={() => requestInstrument("DEMO_BOLETO")}>Boleto demo</button>
                <button className="button secondary" onClick={() => requestInstrument("DEMO_PIX")}>Pix demo</button>
              </div>
              {instrument && (
                <div className="instrument-output">
                  <strong>{instrument.warning}</strong>
                  <code>{instrument.displayValue}</code>
                  <small>Conteúdo exibido somente como texto. Não é clicável, executável ou pagável.</small>
                </div>
              )}
            </section>
          )}

          <div className="actions-grid">
            <form className="action-card" onSubmit={submitPromise}>
              <h3>Promessa de pagamento</h3>
              <p>Registre uma intenção futura. Isso não representa pagamento.</p>
              <label htmlFor="promisedDate">Data prometida</label>
              <input id="promisedDate" name="promisedDate" type="date" required />
              <button className="button secondary">Registrar promessa</button>
            </form>
            <form className="action-card" onSubmit={submitReport}>
              <h3>Informar pagamento</h3>
              <p>A informação ficará pendente de análise, sem quitação automática.</p>
              <label htmlFor="reportedAt">Data e hora declaradas</label>
              <input id="reportedAt" name="reportedAt" type="datetime-local" required />
              <button className="button secondary">Informar, sem confirmar</button>
            </form>
            <form className="action-card" onSubmit={submitDispute}>
              <h3>Contestar dívida</h3>
              <p>Não inclua documentos, dados bancários ou informações pessoais.</p>
              <label htmlFor="reasonCode">Motivo</label>
              <select id="reasonCode" name="reasonCode" required defaultValue="">
                <option value="" disabled>Selecione</option>
                <option value="NOT_RECOGNIZED">Não reconheço</option>
                <option value="AMOUNT_INCORRECT">Valor incorreto</option>
                <option value="ALREADY_PAID">Pagamento já realizado</option>
                <option value="OTHER">Outro</option>
              </select>
              <label htmlFor="description">Descrição opcional (máx. 300)</label>
              <textarea id="description" name="description" maxLength={300} rows={3} />
              <button className="button secondary">Registrar contestação</button>
            </form>
          </div>
        </section>
      )}

      {receipt && (
        <aside className="receipt" role="status">
          <span aria-hidden="true">✓</span>
          <div><h3>{receipt.title}</h3>{receipt.lines.map((line) => <p key={line}>{line}</p>)}</div>
        </aside>
      )}

      <footer>
        <strong>DEMONSTRAÇÃO — SEM VALOR FINANCEIRO</strong>
        <span>
          Sem IA · Sem WhatsApp · Sem integração financeira real · v{version}
        </span>
      </footer>
    </main>
  );
}
