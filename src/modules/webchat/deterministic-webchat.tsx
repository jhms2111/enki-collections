"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  acceptOffer, closeConversation, createConversation, DemoApiError,
  getChallenge, getConversation, getDebt, identify,
  listDebts, listOffers, openDispute, optOutConversation, registerPromise,
  reportPayment, verifyIdentity,
  type Conversation, type CreditorGroup, type Debt, type Offer, type PublicChallenge,
} from "@/modules/demo-ui/demo-api";
import { clearIntentKey, getIntentKey } from "@/modules/demo-ui/idempotency-client";
import { interpretSafeChatText } from "./deterministic-intent";
import { guidedInstitutionalAnswer } from "./institutional-knowledge";

type Message = Readonly<{ id: string; actor: "bot" | "user"; text: string; actions?: readonly string[]; link?: Readonly<{ href: string; label: string }> }>;
type InputRequest = Readonly<{ conversationId: string; kind: "PROMISE" | "REPORT" | "DISPUTE" }>;
type Pending = Readonly<{
  conversationId: string;
  expiresAt: number;
  kind: "ACCEPT" | "PROMISE" | "REPORT" | "DISPUTE" | "OPT_OUT" | "CLOSE";
  fingerprint: string;
  payload?: Readonly<Record<string, string>>;
}>;

const confirmationPhrase = {
  ACCEPT: "CONFIRMO O ACEITE",
  PROMISE: "CONFIRMO A PROMESSA",
  REPORT: "CONFIRMO O PAGAMENTO INFORMADO",
  DISPUTE: "CONFIRMO A CONTESTAÇÃO",
  OPT_OUT: "CONFIRMO A INTERRUPÇÃO",
  CLOSE: "CONFIRMO O ENCERRAMENTO",
} as const;
const confirmationTtlMs = 2 * 60 * 1_000;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const formatMoney = (cents: number) => money.format(cents / 100);
const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeZone: "UTC" })
  .format(new Date(`${value.slice(0, 10)}T12:00:00.000Z`));
const installmentCountLabel = (count: number) => ({ 1: "uma", 2: "duas", 3: "três", 4: "quatro", 5: "cinco", 6: "seis", 7: "sete", 8: "oito", 9: "nove", 10: "dez", 11: "onze", 12: "doze" }[count] ?? String(count));
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const currentTimestamp = () => Date.now();
const dateChoice = (daysFromToday: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10).split("-").reverse().join("/");
};

function safeError(error: unknown) {
  if (error instanceof DemoApiError) {
    if (error.status === 429) return "Muitas tentativas. Aguarde um pouco antes de continuar.";
    if (error.status >= 500) return "A demonstração está temporariamente indisponível.";
    return error.message;
  }
  return "Não foi possível concluir esta solicitação. Tente novamente.";
}

export function extractDemoIdentifier(value: string): string | null {
  return value.toUpperCase().match(/\bDEMO-[A-Z0-9]{2,16}-[A-Z0-9]{3,8}\b/)?.[0] ?? null;
}
export function scrollChatEnd(element: HTMLDivElement | null): void {
  element?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
}
export function isExactPendingConfirmation(pending: Pending, value: string, conversationId: string, now = Date.now()): boolean {
  return pending.conversationId === conversationId && pending.expiresAt > now && value.trim() === confirmationPhrase[pending.kind];
}

function choiceIndex(value: string): number | null {
  const normalized = normalize(value);
  const numeric = normalized.match(/^(?:opcao\s*)?(\d+)(?:\D.*)?$/)?.[1];
  if (numeric) return Number(numeric) - 1;
  const ordinals: Record<string, number> = { "a primeira": 0, primeira: 0, "a segunda": 1, segunda: 1, "a terceira": 2, terceira: 2 };
  return ordinals[normalized] ?? null;
}
function parseDemoDate(value: string): string | null {
  const clean = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const br = clean.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  return br ? `${br[3]}-${br[2]}-${br[1]}` : null;
}
function parseReportedAt(value: string): string | null {
  const clean = value.trim();
  const iso = clean.match(/\b(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})\b/);
  const br = clean.match(/\b(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})\b/);
  const local = iso ? `${iso[1]}T${iso[2]}` : br ? `${br[3]}-${br[2]}-${br[1]}T${br[4]}` : null;
  if (!local) return null;
  const parsed = new Date(local);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function DeterministicWebchat({ slug, version }: { slug: string; version: string }) {
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [challenge, setChallenge] = useState<PublicChallenge | null>(null);
  const [creditors, setCreditors] = useState<readonly CreditorGroup[]>([]);
  const [debt, setDebt] = useState<(Debt & { creditor: { displayName: string } }) | null>(null);
  const [offers, setOffers] = useState<readonly Offer[]>([]);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [acceptanceId, setAcceptanceId] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly Message[]>([
    { id: "welcome", actor: "bot", text: "Olá! Identificamos uma pendência disponível para negociação.\n\nEstamos aqui para ajudar você a consultar os detalhes e conhecer as propostas autorizadas para regularização.\n\nComo deseja continuar?", actions: ["Quem somos", "Negociar dívida"] },
  ]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [inputRequest, setInputRequest] = useState<InputRequest | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [identifierVisible, setIdentifierVisible] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);
  const processingRef = useRef(false);
  const storageKey = `enki-chat:conversation:${slug}`;
  const terminal = conversation?.state === "CLOSED" || conversation?.state === "OPTED_OUT";
  const hasAcceptedOffer = Boolean(acceptanceId) || conversation?.state === "OFFER_ACCEPTED";
  const activeActionMessageId = [...messages].reverse().find((message) => message.actor === "bot" && message.actions?.length)?.id;

  const bot = useCallback((content: string, options?: Readonly<{ actions?: readonly string[]; link?: Message["link"] }>) => setMessages((current) => [...current, { id: crypto.randomUUID(), actor: "bot", text: content, actions: options?.actions ?? ["Menu inicial"], ...(options?.link ? { link: options.link } : {}) }]), []);
  const user = useCallback((content: string) => setMessages((current) => [...current, { id: crypto.randomUUID(), actor: "user", text: content }]), []);
  const debtRows = creditors.flatMap((creditor) => creditor.debts.map((item) => ({ creditor, item })));

  const showDebts = useCallback((groups: readonly CreditorGroup[]) => {
    const rows = groups.flatMap((creditor) => creditor.debts.map((item) => ({ creditor, item })));
    bot(rows.length ? "Encontrei as seguintes pendências disponíveis para consulta. Escolha qual deseja negociar." : "Nenhuma pendência demonstrativa foi localizada.", rows.length ? { actions: [...rows.map(({ item }, index) => `${index + 1}. ${item.description} — ${formatMoney(item.amount.amountInCents)}`), "Quem somos", "Voltar ao início"] } : { actions: ["Quem somos", "Voltar ao início"] });
  }, [bot]);
  const showOffers = useCallback((items: readonly Offer[], selectedDebt?: Debt & { creditor: { displayName: string } }) => {
    const availableActions = items.flatMap((item, index) => item.status === "AVAILABLE" ? [`${index + 1}. ${item.terms.kind === "CASH" ? `À vista — ${formatMoney(item.terms.total.amountInCents)}` : `Parcelada — ${item.terms.installmentCount} parcelas de ${formatMoney(item.terms.installmentAmount.amountInCents)}`}`] : []);
    const summary = selectedDebt ? `Credor: ${selectedDebt.creditor.displayName}\nDívida: ${selectedDebt.description}\nValor: ${formatMoney(selectedDebt.amount.amountInCents)}\nVencimento: ${formatDate(selectedDebt.dueDate)}\nSituação: ${selectedDebt.status}\n\n` : "";
    const offerText = items.length ? items.map((item, index) => `${index + 1}. ${item.terms.kind === "CASH" ? `À vista — ${formatMoney(item.terms.total.amountInCents)}` : `Parcelada — ${item.terms.installmentCount} parcelas de ${formatMoney(item.terms.installmentAmount.amountInCents)}`}${item.status === "AVAILABLE" ? "" : " — Expirada e indisponível"}`).join("\n") : "Nenhuma proposta autorizada está disponível.";
    bot(`${summary}Propostas autorizadas:\n${offerText}`, { actions: [...availableActions, "Escolher outra dívida", "Como funciona o pagamento", "Quem somos"] });
  }, [bot]);

  useEffect(() => {
    const stored = sessionStorage.getItem(storageKey);
    const restore = async () => {
      if (stored) {
        try {
          const restored = (await getConversation(stored)).conversation;
          setConversation(restored);
          if (restored.identityStatus === "PENDING") {
            const current = await getChallenge(restored.id); setChallenge(current.challenge);
            if (current.challenge) bot(`${current.challenge.prompt}\n${current.challenge.options.map((item, index) => `${index + 1}. ${item.label}`).join("\n")}\nResponda escrevendo o número ou o texto da opção.`);
          } else if (restored.identityStatus === "VERIFIED") {
            const listed = await listDebts(restored.id); setCreditors(listed.creditors); showDebts(listed.creditors);
          } else setIdentifierVisible(false);
          return;
        } catch { sessionStorage.removeItem(storageKey); }
      }
      const created = await createConversation(slug);
      setConversation(created.conversation); sessionStorage.setItem(storageKey, created.conversation.id);
    };
    restore().catch((caught) => setError(safeError(caught))).finally(() => setBusy(false));
  }, [bot, showDebts, slug, storageKey]);
  useEffect(() => scrollChatEnd(logEnd.current), [messages, busy]);

  async function selectDebt(value: string): Promise<boolean> {
    if (!conversation) return false;
    const indexed = choiceIndex(value); const normalized = normalize(value);
    const matches = debtRows.filter(({ creditor, item }, index) => index === indexed || normalize(`${creditor.displayName} ${item.description}`).includes(normalized));
    if (matches.length !== 1) return false;
    const selected = matches[0];
    const [detail, available] = await Promise.all([getDebt(conversation.id, selected.item.debtRef), listOffers(conversation.id, selected.item.debtRef)]);
    setDebt(detail.debt); setOffers(available.offers); setOffer(null); setAcceptanceId(null); setPending(null); setInputRequest(null);
    showOffers(available.offers, detail.debt);
    return true;
  }
  function selectOffer(value: string): Offer | null {
    const indexed = choiceIndex(value); const normalized = normalize(value);
    const matches = offers.filter((item, index) => item.status === "AVAILABLE" && (index === indexed || (normalized.includes("parcel") && item.terms.kind === "INSTALLMENT") || (normalized.includes("vista") && item.terms.kind === "CASH")));
    return matches.length === 1 ? matches[0] : null;
  }
  function explainOffer(selected: Offer): string {
    if (selected.terms.kind === "CASH") {
      return `Esta proposta é à vista, no valor total de ${formatMoney(selected.terms.total.amountInCents)}, com vencimento em ${formatDate(selected.terms.firstDueDate)}. Nenhuma decisão foi registrada.`;
    }
    return `Esta proposta tem valor total de ${formatMoney(selected.terms.total.amountInCents)}, dividido em ${installmentCountLabel(selected.terms.installmentCount)} parcelas de ${formatMoney(selected.terms.installmentAmount.amountInCents)}. A primeira parcela corresponde à entrada, com vencimento em ${formatDate(selected.terms.firstDueDate)}.`;
  }
  function createPending(kind: Pending["kind"], fingerprint: string, payload?: Record<string, string>) {
    if (!conversation) return;
    setInputRequest(null); setPending({ conversationId: conversation.id, kind, fingerprint, payload, expiresAt: currentTimestamp() + confirmationTtlMs });
    const confirmLabel = kind === "ACCEPT" ? "Confirmar aceite" : confirmationPhrase[kind];
    if (kind === "ACCEPT" && debt && offer) {
      const installmentDetails = offer.terms.kind === "INSTALLMENT"
        ? `\nEntrada: ${formatMoney(offer.terms.downPayment.amountInCents)}\nParcelas: ${offer.terms.installmentCount} de ${formatMoney(offer.terms.installmentAmount.amountInCents)}`
        : "";
      bot(`Revise antes de confirmar:\nCredor: ${debt.creditor.displayName}\nDívida: ${debt.description}\nModalidade: ${offer.terms.kind === "CASH" ? "À vista" : "Parcelada"}\nValor total: ${formatMoney(offer.terms.total.amountInCents)}${installmentDetails}\nPrimeiro vencimento: ${formatDate(offer.terms.firstDueDate)}\nValidade: ${formatDate(offer.expiresAt)}\n\nAté este momento, nenhuma proposta foi aceita.`, { actions: [confirmLabel, "Escolher outra proposta", "Cancelar"] });
      return;
    }
    bot("Revise as informações e confirme conscientemente para continuar.", { actions: [confirmLabel, "Cancelar"] });
  }
  async function executePending(current: Pending) {
    if (!conversation || current.conversationId !== conversation.id) return;
    if (current.kind === "ACCEPT" && debt && offer) {
      const scope = `chat:accept:${conversation.id}:${debt.debtRef}:${offer.offerRef}`;
      const result = await acceptOffer({ conversationId: conversation.id, debtRef: debt.debtRef, offer, idempotencyKey: getIntentKey(scope, current.fingerprint) });
      clearIntentKey(scope); setAcceptanceId(result.acceptance.id); bot("Proposta demonstrativa aceita com sucesso. Agora você pode acessar a página de pagamento para revisar as condições e gerar seu instrumento demonstrativo.", { actions: ["Entender como funciona o pagamento", "Iniciar nova simulação", "Encerrar atendimento"], link: { href: `/demo/${encodeURIComponent(slug)}/payment`, label: "Abrir página de pagamento" } });
    } else if (current.kind === "PROMISE" && debt && current.payload?.date) {
      const scope = `chat:promise:${conversation.id}:${debt.debtRef}`;
      const result = await registerPromise({ conversationId: conversation.id, debtRef: debt.debtRef, promisedDate: current.payload.date, offerRef: offer?.offerRef, idempotencyKey: getIntentKey(scope, current.fingerprint) });
      clearIntentKey(scope); bot(`Promessa registrada para ${formatDate(result.promise.promisedDate)}. Isso não representa pagamento ou quitação.`);
    } else if (current.kind === "REPORT" && debt && current.payload?.reportedAt) {
      const scope = `chat:report:${conversation.id}:${debt.debtRef}`;
      const result = await reportPayment({ conversationId: conversation.id, debtRef: debt.debtRef, reportedAt: current.payload.reportedAt, idempotencyKey: getIntentKey(scope, current.fingerprint) });
      clearIntentKey(scope); bot(`Pagamento informado com situação ${result.report.status}. Não há confirmação de pagamento ou quitação.`);
    } else if (current.kind === "DISPUTE" && debt && current.payload?.reasonCode) {
      const scope = `chat:dispute:${conversation.id}:${debt.debtRef}`;
      const result = await openDispute({ conversationId: conversation.id, debtRef: debt.debtRef, reasonCode: current.payload.reasonCode, description: current.payload.description || undefined, idempotencyKey: getIntentKey(scope, current.fingerprint) });
      clearIntentKey(scope); bot(`Contestação ${result.dispute.status}. Ela depende de análise e nenhuma decisão foi tomada automaticamente.`);
    } else if (current.kind === "OPT_OUT") {
      setConversation((await optOutConversation(conversation.id)).conversation); bot("As mensagens foram interrompidas.");
    } else if (current.kind === "CLOSE") {
      setConversation((await closeConversation(conversation.id)).conversation); bot("Atendimento encerrado.");
    }
    setPending(null);
  }

  async function collectRequestedInput(value: string): Promise<boolean> {
    if (!conversation || !inputRequest || inputRequest.conversationId !== conversation.id) return false;
    if (inputRequest.kind === "PROMISE") {
      const date = parseDemoDate(value); if (!date) { bot("Informe a data no formato DD/MM/AAAA."); return true; }
      bot(`Você declarou a data ${formatDate(date)} para a promessa. Isso não representa pagamento.`); createPending("PROMISE", JSON.stringify({ debtRef: debt?.debtRef, offerRef: offer?.offerRef ?? null, date }), { date }); return true;
    }
    if (inputRequest.kind === "REPORT") {
      const reportedAt = parseReportedAt(value); if (!reportedAt) { bot("Informe a data e hora no formato DD/MM/AAAA HH:MM."); return true; }
      bot("Você está apenas informando um pagamento. A informação ficará pendente de análise e não confirma quitação."); createPending("REPORT", JSON.stringify({ debtRef: debt?.debtRef, reportedAt }), { reportedAt }); return true;
    }
    const normalized = normalize(value); const reasonCode = normalized.includes("nao reconhe") ? "NOT_RECOGNIZED" : normalized.includes("valor") ? "AMOUNT_INCORRECT" : normalized.includes("paguei") || normalized.includes("pago") ? "ALREADY_PAID" : normalized === "outro motivo" ? "OTHER" : null;
    if (!reasonCode) { bot("Escolha um dos motivos demonstrativos disponíveis.", { actions: ["Não reconheço", "Valor incorreto", "Já informei pagamento", "Outro motivo"] }); return true; }
    const description = reasonCode === "OTHER" ? "Motivo padronizado demonstrativo" : "";
    bot("A contestação ficará pendente de análise e não será decidida automaticamente."); createPending("DISPUTE", JSON.stringify({ debtRef: debt?.debtRef, reasonCode, description }), { reasonCode, description }); return true;
  }

  async function prepareIntent(intent: string, source: string) {
    if (!conversation) return;
    if (intent === "LIST_DEBTS") { setDebt(null); setOffer(null); showDebts(creditors); return; }
    if (!debt && await selectDebt(source)) return;
    if ((intent === "LIST_OFFERS" || intent === "SELECT_OFFER") && debt) {
      const selected = selectOffer(source); if (selected) { setOffer(selected); bot(explainOffer(selected), { actions: ["Confirmar esta proposta", "Escolher outra proposta", "Voltar para as dívidas", "Como funciona o pagamento"] }); }
      else showOffers(offers); return;
    }
    if (intent === "ACCEPT_OFFER") {
      if (!offer) { bot("Escolha primeiro uma proposta por número, “à vista” ou “parcelada”."); return; }
      createPending("ACCEPT", JSON.stringify({ offerRef: offer.offerRef, providerVersion: offer.providerVersion, terms: offer.terms })); return;
    }
    if (intent === "REQUEST_INSTRUMENT") {
      if (!hasAcceptedOffer) {
        if (offer) bot(`A condição selecionada é ${offer.terms.kind === "CASH" ? "à vista" : "parcelada"}, com total de ${formatMoney(offer.terms.total.amountInCents)} e primeiro vencimento em ${formatDate(offer.terms.firstDueDate)}. Para liberar a página demonstrativa de pagamento, primeiro confirme o aceite da proposta.`);
        else bot("Para acessar a página demonstrativa de pagamento, primeiro consulte as propostas autorizadas, escolha uma condição e confirme o aceite.");
        return;
      }
      bot("Para sua segurança, revise as condições na página de pagamento e escolha uma opção demonstrativa. Nenhum pagamento real será realizado e isso não representa quitação.", { link: { href: `/demo/${encodeURIComponent(slug)}/payment`, label: "Abrir página de pagamento" } }); return;
    }
    if (["MAKE_PAYMENT_PROMISE", "REPORT_PAYMENT", "DISPUTE_DEBT"].includes(intent) && !debt) { bot("Escolha primeiro uma dívida."); return; }
    if (intent === "MAKE_PAYMENT_PROMISE") { setInputRequest({ conversationId: conversation.id, kind: "PROMISE" }); bot("Escolha uma data demonstrativa para a promessa. O registro não representa pagamento.", { actions: [dateChoice(7), dateChoice(14), dateChoice(30), "Cancelar"] }); }
    else if (intent === "REPORT_PAYMENT") { setInputRequest({ conversationId: conversation.id, kind: "REPORT" }); bot("Escolha quando o pagamento teria sido realizado. A informação ficará pendente de análise.", { actions: ["Hoje", "Ontem", "Cancelar"] }); }
    else if (intent === "DISPUTE_DEBT") { setInputRequest({ conversationId: conversation.id, kind: "DISPUTE" }); bot("Qual é o motivo da contestação?", { actions: ["Não reconheço", "Valor incorreto", "Já informei pagamento", "Outro motivo"] }); }
    else if (intent === "OPT_OUT") createPending("OPT_OUT", "opt-out");
    else if (intent === "CLOSE") createPending("CLOSE", "close");
  }

  async function processMessage(value: string) {
    if (!conversation || processingRef.current || terminal || !value.trim()) return;
    processingRef.current = true;
    user(value); setText(""); setBusy(true); setError(null);
    try {
      if (pending) {
        if (pending.expiresAt <= currentTimestamp()) { setPending(null); bot("A confirmação expirou. Solicite a operação novamente."); return; }
        if (isExactPendingConfirmation(pending, value, conversation.id) || (pending.kind === "ACCEPT" && normalize(value) === "confirmar aceite")) { await executePending(pending); return; }
        if (pending.kind === "ACCEPT" && normalize(value) === "escolher outra proposta") { setPending(null); setOffer(null); showOffers(offers, debt ?? undefined); return; }
        if (normalize(value) === "cancelar") { setPending(null); bot("Operação cancelada. Nenhuma alteração foi realizada.", { actions: offer ? ["Confirmar esta proposta", "Escolher outra proposta", "Voltar para as dívidas"] : ["Voltar ao início"] }); return; }
        if (normalize(value).startsWith("confirmo")) { bot(`A frase não corresponde à confirmação pendente. Escreva exatamente: ${confirmationPhrase[pending.kind]}`); return; }
        setPending(null); bot("A confirmação anterior foi cancelada. Nenhuma operação foi executada.");
      }
      if (inputRequest && normalize(value) === "cancelar") {
        setInputRequest(null); bot("Operação cancelada. Nenhuma alteração foi realizada.", { actions: ["Menu inicial"] }); return;
      }
      if (inputRequest?.kind === "REPORT" && (normalize(value) === "hoje" || normalize(value) === "ontem")) {
        const declared = new Date(); if (normalize(value) === "ontem") declared.setUTCDate(declared.getUTCDate() - 1);
        await collectRequestedInput(`${declared.toISOString().slice(0, 10)} 12:00`); return;
      }
      if (await collectRequestedInput(value)) return;
      const communicationIntent = interpretSafeChatText(value);
      if (communicationIntent === "OPT_OUT" || communicationIntent === "CLOSE") {
        await prepareIntent(communicationIntent, value);
        return;
      }
      if (conversation.identityStatus === "NOT_STARTED") {
        if (normalize(value) === "negociar divida") {
          setIdentifierVisible(true);
          bot("Para localizar sua negociação, informe o número do seu identificador.", { actions: ["Voltar"] });
          return;
        }
        if (normalize(value) === "voltar" || normalize(value) === "voltar ao inicio") {
          setIdentifierVisible(false);
          bot("Como deseja continuar?", { actions: ["Quem somos", "Negociar dívida"] });
          return;
        }
        const demoIdentifier = extractDemoIdentifier(value);
        if (!demoIdentifier) {
          const institutional = guidedInstitutionalAnswer(value);
          if (institutional) bot(institutional.message, { actions: institutional.actions });
          return;
        }
        const result = await identify(conversation.id, demoIdentifier); setConversation(result.conversation); setChallenge(result.verificationRequired ? result.challenge : null); setIdentifierVisible(false);
        if (!result.verificationRequired) {
          const listed = await listDebts(conversation.id); setCreditors(listed.creditors);
          showDebts(listed.creditors);
        } else if (result.challenge) {
          bot(`${result.challenge.prompt}\n${result.challenge.options.map((item, index) => `${index + 1}. ${item.label}`).join("\n")}`, { actions: result.challenge.options.map((item) => item.label) });
        }
        return;
      }
      if (conversation.identityStatus === "PENDING" && challenge) {
        const indexed = choiceIndex(value); const normalized = normalize(value); const matches = challenge.options.filter((item, index) => index === indexed || normalize(item.label) === normalized);
        if (matches.length !== 1) { bot("Não consegui identificar uma única opção. Responda com o número ou o texto exato da opção."); return; }
        const result = await verifyIdentity(conversation.id, matches[0].optionRef); setConversation(result.conversation);
        if (result.verified) { setChallenge(null); const listed = await listDebts(conversation.id); setCreditors(listed.creditors); showDebts(listed.creditors); }
        else if (result.conversation.identityStatus === "BLOCKED") { setChallenge(null); bot("O limite de tentativas foi atingido. Nenhuma dívida foi revelada."); }
        else { const current = await getChallenge(conversation.id); setChallenge(current.challenge); bot(`Resposta não validada. Restam ${result.attemptsRemaining} tentativa(s).`); }
        return;
      }
      const institutional = guidedInstitutionalAnswer(value);
      if (institutional) { bot(institutional.message, { actions: institutional.actions }); return; }
      if (normalize(value) === "negociar divida") { showDebts(creditors); return; }
      if (normalize(value) === "voltar ao inicio") { bot("Como deseja continuar?", { actions: ["Quem somos", "Negociar dívida"] }); return; }
      if (normalize(value) === "cancelar") { setInputRequest(null); bot("Operação cancelada. Nenhuma alteração foi realizada.", { actions: ["Menu inicial"] }); return; }
      if (normalize(value) === "menu inicial" || normalize(value) === "outras informacoes" || normalize(value) === "menu de informacoes") {
        const other = normalize(value) === "outras informacoes";
        bot(other ? "Escolha uma informação ou ocorrência demonstrativa:" : "Como posso ajudar?", { actions: other && debt ? ["Registrar promessa", "Informar pagamento", "Contestar dívida", "Menu inicial"] : other ? ["Segurança", "Consultar minhas dívidas", "Encerrar atendimento"] : ["Quem somos", "Como funciona", "Como funciona o pagamento", "Outras informações"] }); return;
      }
      if (normalize(value) === "consultar minhas dividas" || normalize(value) === "escolher outra divida" || normalize(value) === "voltar para as dividas") { setDebt(null); setOffer(null); showDebts(creditors); return; }
      if (normalize(value) === "registrar promessa") { await prepareIntent("MAKE_PAYMENT_PROMISE", value); return; }
      if (normalize(value) === "informar pagamento") { await prepareIntent("REPORT_PAYMENT", value); return; }
      if (normalize(value) === "contestar divida") { await prepareIntent("DISPUTE_DEBT", value); return; }
      if (normalize(value) === "iniciar nova simulacao") { bot("O aceite anterior permanecerá no histórico demonstrativo. Confirme para iniciar uma nova conversa.", { actions: ["Confirmar nova simulação", "Cancelar"] }); return; }
      if (normalize(value) === "confirmar nova simulacao") { const created = await createConversation(slug); sessionStorage.setItem(storageKey, created.conversation.id); setConversation(created.conversation); setChallenge(null); setCreditors([]); setDebt(null); setOffers([]); setOffer(null); setAcceptanceId(null); setPending(null); setIdentifierVisible(true); bot("Nova simulação iniciada. O aceite anterior permanece no histórico demonstrativo. Para localizar a nova negociação, informe o número do seu identificador.", { actions: ["Voltar"] }); return; }
      if (!debt && await selectDebt(value)) return;
      if (debt && !offer) { const selected = selectOffer(value); if (selected) { setOffer(selected); bot(explainOffer(selected), { actions: ["Confirmar esta proposta", "Escolher outra proposta", "Voltar para as dívidas", "Como funciona o pagamento"] }); return; } }
      if (normalize(value) === "explicar proposta" && offer) {
        bot(`A proposta ${offer.terms.kind === "CASH" ? "à vista" : "parcelada"} tem valor total de ${formatMoney(offer.terms.total.amountInCents)}, entrada de ${formatMoney(offer.terms.downPayment.amountInCents)}, ${offer.terms.installmentCount} parcela(s) de ${formatMoney(offer.terms.installmentAmount.amountInCents)}, primeiro vencimento em ${formatDate(offer.terms.firstDueDate)} e validade até ${formatDate(offer.expiresAt)}.`, { actions: ["Confirmar esta proposta", "Escolher outra proposta", "Como funciona o pagamento", "Voltar para a dívida"] }); return;
      }
      if (normalize(value) === "escolher outra proposta" || normalize(value) === "voltar para a divida" || normalize(value) === "voltar para as propostas" || normalize(value) === "consultar propostas") { setOffer(null); showOffers(offers, debt ?? undefined); return; }
      if (normalize(value) === "confirmar esta proposta") { await prepareIntent("ACCEPT_OFFER", value); return; }
      if (["LIST_OFFERS", "ACCEPT_OFFER", "REQUEST_INSTRUMENT"].includes(communicationIntent)) {
        await prepareIntent(communicationIntent, value);
        return;
      }
      bot("Escolha uma das ações disponíveis para continuar.", { actions: ["Menu inicial"] });
    } catch (caught) {
      const intent = interpretSafeChatText(value);
      try { await prepareIntent(intent, value); } catch { setError(safeError(caught)); }
      if (intent === "UNKNOWN") bot("Escolha uma das ações disponíveis para continuar.", { actions: ["Menu inicial"] });
    } finally { processingRef.current = false; setBusy(false); }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void processMessage(text);
  }

  return <main className="chat-page pure-chat-page">
    <section className="chat-shell pure-chat-shell" aria-label="Atendimento conversacional demonstrativo">
      <header className="chat-title pure-chat-header"><span className="assistant-avatar" aria-hidden="true">E</span><div><h1>Assistente ENKI</h1><p><span className="status-dot" />Atendimento digital · demonstração</p></div><small>v{version}</small></header>
      <div className="chat-log pure-chat-log" role="log" aria-live="polite" aria-relevant="additions">
        {messages.map((message) => <div className={`chat-bubble ${message.actor}`} key={message.id}><span>{message.actor === "bot" ? "Assistente ENKI" : "Você"}</span><p>{message.text}</p>{message.actions?.length ? <div className="chat-chips" aria-label="Sugestões de resposta">{message.actions.map((action) => <button type="button" key={action} disabled={busy || terminal || message.id !== activeActionMessageId} onClick={() => void processMessage(action)}>{action}</button>)}</div> : null}{message.link && <a className="chat-payment-link" href={message.link.href}>{message.link.label}</a>}</div>)}
        {error && <div className="chat-bubble bot" role="alert"><span>Assistente ENKI</span><p>{error}</p></div>}
        {busy && <div className="typing" role="status"><span aria-hidden="true"><i /><i /><i /></span>Assistente está digitando…</div>}
        <div ref={logEnd} />
      </div>
      {conversation?.identityStatus === "NOT_STARTED" && identifierVisible && <form className="identifier-entry" onSubmit={submit}><label htmlFor="demoIdentifier">Número do identificador</label><div><input id="demoIdentifier" value={text} onChange={(event) => setText(event.target.value)} autoComplete="off" placeholder="DEMO-..." /><button className="primary-action" disabled={busy || !text.trim()}>Continuar</button></div></form>}
    </section>
  </main>;
}
