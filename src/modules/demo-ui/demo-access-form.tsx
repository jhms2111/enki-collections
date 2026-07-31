"use client";

import { useState } from "react";

export function DemoAccessForm({ returnTo }: { returnTo: string }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [limited, setLimited] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    setLimited(false);
    setUnavailable(false);
    try {
      const response = await fetch("/api/v1/demo-access/authenticate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, returnTo }),
      });
      const payload = (await response.json()) as {
        redirectTo?: string;
        error?: {
          message?: string;
          attemptsRemaining?: number;
        };
      };
      if (response.ok && payload.redirectTo) {
        window.location.assign(payload.redirectTo);
        return;
      }
      setLimited(response.status === 429);
      setUnavailable(response.status === 503);
      setMessage(
        payload.error?.message ??
          "Não foi possível validar o acesso à demonstração.",
      );
      if (
        typeof payload.error?.attemptsRemaining === "number" &&
        response.status === 401
      ) {
        setMessage(
          `${payload.error.message} ${payload.error.attemptsRemaining} tentativa(s) restante(s).`,
        );
      }
    } catch {
      setUnavailable(true);
      setMessage("A demonstração está temporariamente indisponível.");
    } finally {
      setBusy(false);
      setCode("");
    }
  }

  return (
    <main className="access-page">
      <div className="demo-ribbon">
        PROTÓTIPO PESSOAL · DADOS FICTÍCIOS · SEM VALOR FINANCEIRO
      </div>
      <section className="access-card">
        <div className="brand access-brand">
          <span className="brand-mark" aria-hidden="true">E</span>
          <span>ENKI <strong>Collections</strong></span>
        </div>
        <p className="eyebrow">Acesso restrito à demonstração</p>
        <h1>Insira o código de apresentação</h1>
        <p>
          Este ambiente contém somente fixtures fictícias. Não informe CPF,
          credenciais ou qualquer dado pessoal real.
        </p>
        {message && (
          <div
            className={`alert ${limited ? "rate-limit" : unavailable ? "unavailable" : "error"}`}
            role="alert"
          >
            <strong>
              {limited
                ? "Limite temporário atingido"
                : unavailable
                  ? "Serviço indisponível"
                  : "Acesso não autorizado"}
            </strong>
            <span>{message}</span>
          </div>
        )}
        <form className="form-stack" onSubmit={submit}>
          <label htmlFor="demo-access-code">Código da demonstração</label>
          <input
            id="demo-access-code"
            type="password"
            autoComplete="off"
            minLength={8}
            maxLength={128}
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button className="button primary" disabled={busy || limited}>
            {busy ? "Validando…" : "Acessar protótipo"}
          </button>
        </form>
        <small className="access-note">
          Sem compromisso de disponibilidade. Nenhuma operação financeira real.
        </small>
      </section>
    </main>
  );
}
