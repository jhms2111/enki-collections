"use client";

import { FormEvent, ReactNode, useState } from "react";

type Summary = { profileRef: string; demoIdentifier: string; scenarioName: string; debtorName: string; active: boolean; creditorCount: number; debtCount: number; offerCount: number };
type Offer = { kind: "CASH" | "INSTALLMENT"; totalAmountInCents: number; downPaymentAmountInCents: number; installmentCount: number; installmentAmountInCents: number; firstDueDate: string; expiresAt: string };
type Scenario = { demoConfirmation: boolean; scenarioName: string; debtor: { displayName: string }; challenge: { prompt: string; correctOptionIndex: number; options: { label: string }[] }; creditor: { displayName: string }; debt: { description: string; amountInCents: number; dueDate: string }; offers: Offer[] };
type FieldErrors = Record<string, string>;

const blankOffer = (): Offer => ({ kind: "CASH", totalAmountInCents: 10000, downPaymentAmountInCents: 10000, installmentCount: 1, installmentAmountInCents: 10000, firstDueDate: "2099-01-10", expiresAt: "2099-01-10T23:59:59.000Z" });
const empty = (): Scenario => ({ demoConfirmation: false, scenarioName: "", debtor: { displayName: "" }, challenge: { prompt: "", correctOptionIndex: 0, options: [{ label: "" }, { label: "" }] }, creditor: { displayName: "" }, debt: { description: "", amountInCents: 10000, dueDate: "2099-01-01" }, offers: [blankOffer()] });
const example = (): Scenario => ({ demoConfirmation: false, scenarioName: "Cenário Feira das Estrelas", debtor: { displayName: "Pessoa Fictícia Aurora" }, challenge: { prompt: "Qual cor demonstrativa foi combinada?", correctOptionIndex: 1, options: [{ label: "Azul fictício" }, { label: "Verde fictício" }, { label: "Amarelo fictício" }] }, creditor: { displayName: "Credor Demonstrativo Horizonte" }, debt: { description: "Contrato exclusivamente fictício", amountInCents: 125000, dueDate: "2099-01-15" }, offers: [{ kind: "CASH", totalAmountInCents: 100000, downPaymentAmountInCents: 100000, installmentCount: 1, installmentAmountInCents: 100000, firstDueDate: "2099-01-20", expiresAt: "2099-01-19T23:59:59.000Z" }] });

function Field({ label, path, error, children }: { label: string; path: string; error?: string; children: ReactNode }) {
  return <label>{label}{children}{error && <span className="field-error" id={`${path}-error`}>{error}</span>}</label>;
}

export function ScenarioManager({ initial }: { initial: Summary[] }) {
  const [items, setItems] = useState(initial);
  const [form, setForm] = useState<Scenario>(empty());
  const [editing, setEditing] = useState<string>();
  const [message, setMessage] = useState("");
  const [createdIdentifier, setCreatedIdentifier] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);

  const setSection = <K extends keyof Scenario>(section: K, value: Scenario[K]) => setForm((current) => ({ ...current, [section]: value }));
  const errorFor = (path: string) => errors[path];
  const trim = (value: string, apply: (next: string) => void) => apply(value.trim());
  async function refresh() { const response = await fetch("/api/v1/internal/scenarios", { cache: "no-store" }); if (response.ok) setItems(await response.json()); }

  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage(""); setCreatedIdentifier(""); setErrors({});
    const url = editing ? `/api/v1/internal/scenarios/${encodeURIComponent(editing)}` : "/api/v1/internal/scenarios";
    try {
      const response = await fetch(url, { method: editing ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const result = await response.json();
      if (!response.ok) {
        setErrors(Object.fromEntries((result.fieldErrors ?? []).map((item: { path: string; message: string }) => [item.path, item.message])));
        throw new Error(result.error?.message ?? "Não foi possível salvar.");
      }
      setMessage(editing ? "Cenário atualizado e versionado." : "Cenário fictício criado. Use o identificador abaixo no teste público.");
      setCreatedIdentifier(result.demoIdentifier);
      setEditing(undefined); setForm(empty()); await refresh();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "Não foi possível salvar."); } finally { setBusy(false); }
  }

  async function edit(profileRef: string) {
    setErrors({}); setMessage(""); setCreatedIdentifier("");
    const response = await fetch(`/api/v1/internal/scenarios/${encodeURIComponent(profileRef)}`, { cache: "no-store" }); const value = await response.json();
    if (!response.ok) { setMessage(value.error?.message ?? "Falha ao carregar."); return; }
    setEditing(profileRef); setForm({ demoConfirmation: true, scenarioName: value.scenarioName, debtor: value.debtor, challenge: value.challenge, creditor: value.creditor, debt: value.debt, offers: value.offers.map((offer: Offer) => ({ kind: offer.kind, totalAmountInCents: offer.totalAmountInCents, downPaymentAmountInCents: offer.downPaymentAmountInCents, installmentCount: offer.installmentCount, installmentAmountInCents: offer.installmentAmountInCents, firstDueDate: offer.firstDueDate, expiresAt: offer.expiresAt })) });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function toggle(item: Summary) { const response = await fetch(`/api/v1/internal/scenarios/${encodeURIComponent(item.profileRef)}/status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !item.active, demoConfirmation: true }) }); if (!response.ok) setMessage("Não foi possível alterar o status."); await refresh(); }
  const updateOffer = (index: number, patch: Partial<Offer>) => setForm((current) => ({ ...current, offers: current.offers.map((offer, position) => position === index ? { ...offer, ...patch } : offer) }));
  const updateOption = (index: number, label: string) => setSection("challenge", { ...form.challenge, options: form.challenge.options.map((option, position) => position === index ? { label } : option) });

  return <main className="internal-page">
    <div className="demo-ribbon">SANDBOX INTERNO — SOMENTE DADOS FICTÍCIOS — SEM VALOR FINANCEIRO</div>
    <header className="internal-header"><div><p className="eyebrow">JF Demo</p><h1>Construtor de cenários</h1></div><a className="button secondary" href="/demo/jf-demo" target="_blank" rel="noreferrer">Testar demonstração</a></header>
    <section className="internal-layout"><form className="panel internal-form" onSubmit={submit} noValidate>
      <div className="form-title-row"><div><h2>{editing ? "Editar cenário" : "Novo cenário completo"}</h2><p>As referências e versões são geradas e protegidas pelo servidor.</p></div>{!editing && <button type="button" className="button secondary" onClick={() => { setForm(example()); setErrors({}); }}>Preencher exemplo</button>}</div>
      <fieldset><legend>1. Cenário e pessoa fictícia</legend>
        <Field label="Nome fictício do cenário" path="scenarioName" error={errorFor("scenarioName")}><input value={form.scenarioName} aria-invalid={!!errorFor("scenarioName")} onBlur={(e) => trim(e.target.value, (value) => setSection("scenarioName", value))} onChange={(e) => setSection("scenarioName", e.target.value)}/></Field>
        <Field label="Nome fictício do devedor" path="debtor.displayName" error={errorFor("debtor.displayName")}><input value={form.debtor.displayName} aria-invalid={!!errorFor("debtor.displayName")} onBlur={(e) => trim(e.target.value, (value) => setSection("debtor", { displayName: value }))} onChange={(e) => setSection("debtor", { displayName: e.target.value })}/></Field>
      </fieldset>
      <fieldset><legend>2. Validação demonstrativa</legend>
        <Field label="Pergunta do desafio" path="challenge.prompt" error={errorFor("challenge.prompt")}><input value={form.challenge.prompt} onBlur={(e) => trim(e.target.value, (value) => setSection("challenge", { ...form.challenge, prompt: value }))} onChange={(e) => setSection("challenge", { ...form.challenge, prompt: e.target.value })}/></Field>
        {form.challenge.options.map((option, index) => <Field key={index} label={`Opção ${index + 1}`} path={`challenge.options.${index}.label`} error={errorFor(`challenge.options.${index}.label`)}><input value={option.label} onBlur={(e) => trim(e.target.value, (value) => updateOption(index, value))} onChange={(e) => updateOption(index, e.target.value)}/></Field>)}
        <button type="button" className="text-button" disabled={form.challenge.options.length >= 5} onClick={() => setSection("challenge", { ...form.challenge, options: [...form.challenge.options, { label: "" }] })}>Adicionar opção</button>
        <Field label="Resposta correta" path="challenge.correctOptionIndex" error={errorFor("challenge.correctOptionIndex")}><select value={form.challenge.correctOptionIndex} onChange={(e) => setSection("challenge", { ...form.challenge, correctOptionIndex: Number(e.target.value) })}>{form.challenge.options.map((option, index) => <option key={index} value={index}>{option.label || `Opção ${index + 1}`}</option>)}</select></Field>
      </fieldset>
      <fieldset><legend>3. Credor fictício</legend><Field label="Nome fictício do credor" path="creditor.displayName" error={errorFor("creditor.displayName")}><input value={form.creditor.displayName} onBlur={(e) => trim(e.target.value, (value) => setSection("creditor", { displayName: value }))} onChange={(e) => setSection("creditor", { displayName: e.target.value })}/></Field></fieldset>
      <fieldset><legend>4. Dívida fictícia</legend>
        <Field label="Descrição" path="debt.description" error={errorFor("debt.description")}><input value={form.debt.description} onBlur={(e) => trim(e.target.value, (value) => setSection("debt", { ...form.debt, description: value }))} onChange={(e) => setSection("debt", { ...form.debt, description: e.target.value })}/></Field>
        <div className="inline-fields"><Field label="Valor da dívida (centavos)" path="debt.amountInCents" error={errorFor("debt.amountInCents")}><input type="number" min="1" max="100000000" value={form.debt.amountInCents} onChange={(e) => setSection("debt", { ...form.debt, amountInCents: Number(e.target.value) })}/></Field><Field label="Vencimento" path="debt.dueDate" error={errorFor("debt.dueDate")}><input type="date" value={form.debt.dueDate} onChange={(e) => setSection("debt", { ...form.debt, dueDate: e.target.value })}/></Field></div>
      </fieldset>
      <fieldset><legend>5. Propostas autorizadas</legend>{form.offers.map((offer, index) => <div className="offer-editor" key={index}>
        <Field label="Tipo" path={`offers.${index}.kind`} error={errorFor(`offers.${index}.kind`)}><select value={offer.kind} onChange={(e) => updateOffer(index, { kind: e.target.value as Offer["kind"] })}><option value="CASH">À vista</option><option value="INSTALLMENT">Parcelada</option></select></Field>
        <div className="inline-fields"><Field label="Total (centavos)" path={`offers.${index}.totalAmountInCents`} error={errorFor(`offers.${index}.totalAmountInCents`)}><input type="number" min="1" value={offer.totalAmountInCents} onChange={(e) => updateOffer(index, { totalAmountInCents: Number(e.target.value) })}/></Field><Field label="Entrada (centavos)" path={`offers.${index}.downPaymentAmountInCents`} error={errorFor(`offers.${index}.downPaymentAmountInCents`)}><input type="number" min="0" value={offer.downPaymentAmountInCents} onChange={(e) => updateOffer(index, { downPaymentAmountInCents: Number(e.target.value) })}/></Field><Field label="Parcelas" path={`offers.${index}.installmentCount`} error={errorFor(`offers.${index}.installmentCount`)}><input type="number" min="1" max="120" value={offer.installmentCount} onChange={(e) => updateOffer(index, { installmentCount: Number(e.target.value) })}/></Field><Field label="Valor da parcela (centavos)" path={`offers.${index}.installmentAmountInCents`} error={errorFor(`offers.${index}.installmentAmountInCents`)}><input type="number" min="1" value={offer.installmentAmountInCents} onChange={(e) => updateOffer(index, { installmentAmountInCents: Number(e.target.value) })}/></Field></div>
        <div className="inline-fields"><Field label="Primeiro vencimento" path={`offers.${index}.firstDueDate`} error={errorFor(`offers.${index}.firstDueDate`)}><input type="date" value={offer.firstDueDate} onChange={(e) => updateOffer(index, { firstDueDate: e.target.value })}/></Field><Field label="Expira em" path={`offers.${index}.expiresAt`} error={errorFor(`offers.${index}.expiresAt`)}><input type="datetime-local" value={offer.expiresAt.slice(0, 16)} onChange={(e) => updateOffer(index, { expiresAt: `${e.target.value}:00.000Z` })}/></Field></div>
        {form.offers.length > 1 && <button type="button" className="button secondary" onClick={() => setForm((current) => ({ ...current, offers: current.offers.filter((_, position) => position !== index) }))}>Remover proposta</button>}
      </div>)}<button type="button" className="button secondary" onClick={() => setForm((current) => ({ ...current, offers: [...current.offers, blankOffer()] }))}>Adicionar proposta</button></fieldset>
      <label className="choice"><input type="checkbox" checked={form.demoConfirmation} onChange={(e) => setSection("demoConfirmation", e.target.checked)}/> Confirmo que o cenário é exclusivamente fictício, não contém dados pessoais reais e não gera pagamento.</label>{errorFor("demoConfirmation") && <span className="field-error">{errorFor("demoConfirmation")}</span>}
      {message && <div className="alert" role="status">{message}{createdIdentifier && <div className="created-identifier"><strong>Identificador para o teste público</strong><code>{createdIdentifier}</code><a className="button secondary" href="/demo/jf-demo" target="_blank" rel="noreferrer">Usar na demonstração</a></div>}</div>}
      <div className="button-row"><button className="button primary" disabled={busy}>{busy ? "Salvando…" : editing ? "Salvar nova versão" : "Criar cenário"}</button>{editing && <button type="button" className="button secondary" onClick={() => { setEditing(undefined); setForm(empty()); setErrors({}); }}>Cancelar edição</button>}</div>
    </form>
    <aside className="panel scenario-list"><h2>Cenários</h2>{items.map((item) => <article className="scenario-card" key={item.profileRef}><span className={item.active ? "status-active" : "status-inactive"}>{item.active ? "Ativo" : "Inativo"}</span><h3>{item.scenarioName}</h3><p>{item.debtorName}</p><strong className="demo-id">{item.demoIdentifier}</strong><p>{item.creditorCount} credor · {item.debtCount} dívida · {item.offerCount} proposta(s)</p><div className="button-row"><button className="button secondary" onClick={() => edit(item.profileRef)}>Visualizar/editar</button><button className="button secondary" onClick={() => toggle(item)}>{item.active ? "Desativar" : "Ativar"}</button></div></article>)}</aside>
    </section>
  </main>;
}
