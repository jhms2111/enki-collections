"use client";

import { FormEvent, useState } from "react";

export function InternalAccessForm() {
  const [code, setCode] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setError(""); try { const response = await fetch("/api/v1/internal/authenticate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? "Acesso indisponível."); window.location.assign(result.redirectTo); } catch (reason) { setError(reason instanceof Error ? reason.message : "Acesso indisponível."); } finally { setBusy(false); } }
  return <main className="access-page"><section className="access-card"><p className="eyebrow">ENKI Collections</p><h1>Área interna do sandbox</h1><p>Uso restrito à criação de cenários inteiramente fictícios. Nenhum dado pessoal ou financeiro real é permitido.</p><form className="form-stack" onSubmit={submit}><label htmlFor="internal-code">Código interno</label><input id="internal-code" type="password" minLength={8} maxLength={128} autoComplete="current-password" value={code} onChange={(event) => setCode(event.target.value)} required />{error && <div className="alert error" role="alert">{error}</div>}<button className="button primary" disabled={busy}>{busy ? "Validando…" : "Entrar no sandbox"}</button></form></section></main>;
}
