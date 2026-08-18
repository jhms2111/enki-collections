"use client";

import { useState } from "react";

import type { PublicPaymentContext } from "./payment-page-service";
import { clearIntentKey, getIntentKey } from "@/modules/demo-ui/idempotency-client";

type InstrumentType = "DEMO_PIX" | "DEMO_BOLETO" | "DEMO_LINK";
const options: readonly Readonly<{ type: InstrumentType; title: string; description: string }>[] = [
  { type: "DEMO_PIX", title: "Pix demonstrativo", description: "Exibe somente um texto fictício. Não gera QR Code nem chave Pix." },
  { type: "DEMO_BOLETO", title: "Boleto demonstrativo", description: "Exibe somente uma referência fictícia, sem linha digitável ou código de barras." },
  { type: "DEMO_LINK", title: "Link demonstrativo", description: "Exibe somente um caminho interno fictício, sem acesso bancário ou cobrança." },
];
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "UTC" });
const formatMoney = (cents: number) => money.format(cents / 100);
const formatDate = (value: string) => date.format(new Date(`${value.slice(0, 10)}T12:00:00.000Z`));

export function PaymentPage({ slug, context }: { slug: string; context: PublicPaymentContext }) {
  const [type, setType] = useState<InstrumentType | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [result, setResult] = useState<null | { warning: string; displayValue: string; expiresAt: string }>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!type || confirmation !== "CONFIRMO O INSTRUMENTO" || busy) return;
    setBusy(true); setError(null);
    const scope = `payment-page:${slug}:${type}`;
    const fingerprint = JSON.stringify({ type, confirmation: true });
    try {
      const response = await fetch(`/api/v1/public/organizations/${encodeURIComponent(slug)}/payment-instruments`, {
        method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": getIntentKey(scope, fingerprint) },
        body: JSON.stringify({ type, confirmationText: confirmation }),
      });
      const payload = await response.json() as { instrument?: { warning: string; displayValue: string; expiresAt: string }; error?: { message?: string } };
      if (!response.ok || !payload.instrument) throw new Error(payload.error?.message ?? "Não foi possível gerar o instrumento demonstrativo.");
      clearIntentKey(scope); setResult(payload.instrument); setConfirmation("");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Não foi possível continuar."); }
    finally { setBusy(false); }
  }
  return <main className="payment-page"><section className="payment-shell">
    <p className="demo-stamp">DEMONSTRAÇÃO — SEM VALOR FINANCEIRO</p>
    <header><p>Próximo passo</p><h1>Escolha uma forma demonstrativa</h1><p>Revise as condições aceitas. Nenhuma opção abaixo realiza pagamento ou confirma quitação.</p></header>
    <section className="payment-summary" aria-labelledby="summary-title"><h2 id="summary-title">Proposta aceita</h2><dl><div><dt>Credor</dt><dd>{context.creditorName}</dd></div><div><dt>Dívida</dt><dd>{context.debtDescription}</dd></div><div><dt>Valor total</dt><dd>{formatMoney(context.terms.total.amountInCents)}</dd></div><div><dt>Modalidade</dt><dd>{context.offerKind === "CASH" ? "À vista" : "Parcelada"}</dd></div><div><dt>Entrada</dt><dd>{formatMoney(context.terms.downPayment.amountInCents)}</dd></div><div><dt>Parcelas</dt><dd>{context.terms.installmentCount} de {formatMoney(context.terms.installmentAmount.amountInCents)}</dd></div><div><dt>Primeiro vencimento</dt><dd>{formatDate(context.terms.firstDueDate)}</dd></div><div><dt>Validade</dt><dd>{formatDate(context.offerExpiresAt)}</dd></div></dl></section>
    <form onSubmit={submit}><fieldset><legend>Como deseja visualizar a demonstração?</legend>{options.map((option) => <label className={`payment-option ${type === option.type ? "selected" : ""}`} key={option.type}><input type="radio" name="instrument" value={option.type} checked={type === option.type} onChange={() => { setType(option.type); setResult(null); }} /><span><strong>{option.title}</strong><small>{option.description}</small></span></label>)}</fieldset>
      {type && <div className="payment-confirm"><label htmlFor="payment-confirmation">Para confirmar, escreva <strong>CONFIRMO O INSTRUMENTO</strong></label><input id="payment-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /><button className="primary-action" disabled={busy || confirmation !== "CONFIRMO O INSTRUMENTO"}>{busy ? "Gerando demonstração…" : "Gerar instrumento demonstrativo"}</button></div>}
    </form>
    {error && <p className="payment-error" role="alert">{error}</p>}
    {result && <section className="demo-instrument" aria-live="polite"><strong>{result.warning}</strong><p>{result.displayValue}</p><small>Conteúdo somente textual e tecnicamente não pagável. Não representa pagamento nem quitação.</small></section>}
    <a className="secondary-link" href={`/demo/${encodeURIComponent(slug)}/chat`}>Voltar à conversa</a>
  </section></main>;
}
