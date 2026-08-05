export type Money = Readonly<{
  amountInCents: number;
  currency: "BRL";
}>;

export type OfferTerms = Readonly<{
  kind: "CASH" | "INSTALLMENT";
  total: Money;
  downPayment: Money;
  installmentCount: number;
  installmentAmount: Money;
  firstDueDate: string;
}>;

export type PublicChallenge = Readonly<{
  prompt: string;
  options: readonly Readonly<{ optionRef: string; label: string }>[];
  attemptsRemaining: number;
}>;

export type Conversation = Readonly<{
  id: string;
  state: string;
  identityStatus: string;
  failedIdentityAttempts: number;
  startedAt: string;
  endedAt?: string | null;
  optedOutAt?: string | null;
}>;

export type Debt = Readonly<{
  debtRef: string;
  description: string;
  amount: Money;
  dueDate: string;
  status: string;
}>;

export type CreditorGroup = Readonly<{
  creditorRef: string;
  displayName: string;
  debts: readonly Debt[];
}>;

export type Offer = Readonly<{
  offerRef: string;
  providerVersion: string;
  debtRef: string;
  terms: OfferTerms;
  kind: OfferTerms["kind"];
  total: Money;
  downPayment: Money;
  installmentCount: number;
  installmentAmount: Money;
  firstDueDate: string;
  expiresAt: string;
  status: "AVAILABLE" | "EXPIRED" | "DISABLED";
}>;

export class DemoApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { code: string; message: string; requestId?: string };
  };
  if (!response.ok) {
    const fallbackMessage =
      response.status === 429
        ? "Muitas solicitações. Aguarde antes de tentar novamente."
        : response.status >= 500
          ? "A demonstração está temporariamente indisponível."
          : "Não foi possível concluir a solicitação.";
    throw new DemoApiError(
      payload.error?.code ?? "REQUEST_FAILED",
      payload.error?.message ?? fallbackMessage,
      response.status,
      payload.error?.requestId,
    );
  }
  return payload as T;
}

export function closeConversation(conversationId: string) {
  return requestJson<{ conversation: Conversation }>(
    `/api/v1/public/conversations/${encodeURIComponent(conversationId)}/close`,
    { method: "POST", body: JSON.stringify({ confirmation: true }) },
  );
}

export function optOutConversation(conversationId: string) {
  return requestJson<{ conversation: Conversation }>(
    `/api/v1/public/conversations/${encodeURIComponent(conversationId)}/opt-out`,
    { method: "POST", body: JSON.stringify({ confirmation: true }) },
  );
}

export function interpretConversationTurn(input: {
  conversationId: string;
  message: string;
  clientTurnId: string;
  uiContext: "IDENTITY" | "DEBT_LIST" | "DEBT_DETAIL" | "OFFER_REVIEW" | "ACCEPTED";
}) {
  return requestJson<{
    turn: {
      intent: string;
      message: string;
      suggestedActions: readonly string[];
      requiresConfirmation: boolean;
      fallbackUsed: boolean;
    };
  }>(
    `/api/v1/public/conversations/${encodeURIComponent(input.conversationId)}/interpret`,
    {
      method: "POST",
      body: JSON.stringify({
        message: input.message,
        clientTurnId: input.clientTurnId,
        uiContext: input.uiContext,
      }),
    },
  );
}

export function createConversation(slug: string) {
  return requestJson<{ conversation: Conversation }>(
    `/api/v1/public/organizations/${encodeURIComponent(slug)}/conversations`,
    { method: "POST" },
  );
}

export function getConversation(conversationId: string) {
  return requestJson<{ conversation: Conversation }>(
    `/api/v1/public/conversations/${encodeURIComponent(conversationId)}`,
  );
}

export function identify(conversationId: string, demoIdentifier: string) {
  return requestJson<{
    conversation: Conversation;
    verificationRequired: true;
    challenge: PublicChallenge;
  }>(
    `/api/v1/public/conversations/${encodeURIComponent(conversationId)}/identity/identify`,
    {
      method: "POST",
      body: JSON.stringify({ demoIdentifier }),
    },
  );
}

export function getChallenge(conversationId: string) {
  return requestJson<{
    status: "NOT_STARTED" | "PENDING" | "VERIFIED" | "BLOCKED" | "CLOSED" | "OPTED_OUT";
    challenge: PublicChallenge | null;
    attemptsRemaining: number;
  }>(
    `/api/v1/public/conversations/${encodeURIComponent(conversationId)}/identity/challenge`,
  );
}

export function verifyIdentity(conversationId: string, optionRef: string) {
  return requestJson<{
    conversation: Conversation;
    verified: boolean;
    attemptsRemaining: number;
  }>(
    `/api/v1/public/conversations/${encodeURIComponent(conversationId)}/identity/verify`,
    { method: "POST", body: JSON.stringify({ optionRef }) },
  );
}

export function listDebts(conversationId: string) {
  return requestJson<{ creditors: readonly CreditorGroup[] }>(
    `/api/v1/public/conversations/${encodeURIComponent(conversationId)}/debts`,
  );
}

export function getDebt(conversationId: string, debtRef: string) {
  return requestJson<{ debt: Debt & { creditor: { displayName: string } } }>(
    `/api/v1/public/conversations/${encodeURIComponent(conversationId)}/debts/${encodeURIComponent(debtRef)}`,
  );
}

export function listOffers(conversationId: string, debtRef: string) {
  return requestJson<{ offers: readonly Offer[] }>(
    `/api/v1/public/conversations/${encodeURIComponent(conversationId)}/debts/${encodeURIComponent(debtRef)}/offers`,
  );
}

export function acceptOffer(input: {
  conversationId: string;
  debtRef: string;
  offer: Offer;
  idempotencyKey: string;
}) {
  return requestJson<{
    acceptance: {
      id: string;
      debtRef: string;
      offerRef: string;
      acceptedAt: string;
    };
  }>(
    `/api/v1/public/conversations/${encodeURIComponent(input.conversationId)}/debts/${encodeURIComponent(input.debtRef)}/offers/${encodeURIComponent(input.offer.offerRef)}/accept`,
    {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({
        confirmation: true,
        expectedProviderVersion: input.offer.providerVersion,
        expectedTerms: input.offer.terms,
      }),
    },
  );
}

export function createInstrument(input: {
  conversationId: string;
  acceptanceId: string;
  type: "DEMO_LINK" | "DEMO_BOLETO" | "DEMO_PIX";
  idempotencyKey: string;
}) {
  return requestJson<{
    instrument: {
      type: string;
      displayValue: string;
      expiresAt: string;
      isDemo: true;
      warning: string;
    };
  }>(
    `/api/v1/public/conversations/${encodeURIComponent(input.conversationId)}/acceptances/${encodeURIComponent(input.acceptanceId)}/instruments`,
    {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ type: input.type }),
    },
  );
}

export function registerPromise(input: {
  conversationId: string;
  debtRef: string;
  promisedDate: string;
  offerRef?: string;
  idempotencyKey: string;
}) {
  return requestJson<{ promise: { id: string; promisedDate: string; status: "RECORDED" } }>(
    `/api/v1/public/conversations/${encodeURIComponent(input.conversationId)}/debts/${encodeURIComponent(input.debtRef)}/payment-promises`,
    {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({
        promisedDate: input.promisedDate,
        ...(input.offerRef ? { offerRef: input.offerRef } : {}),
      }),
    },
  );
}

export function reportPayment(input: {
  conversationId: string;
  debtRef: string;
  reportedAt: string;
  idempotencyKey: string;
}) {
  return requestJson<{
    report: {
      id: string;
      reportedAt: string;
      receivedAt: string;
      status: "PENDING_REVIEW";
      warning: string;
    };
  }>(
    `/api/v1/public/conversations/${encodeURIComponent(input.conversationId)}/debts/${encodeURIComponent(input.debtRef)}/payment-reports`,
    {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({ reportedAt: input.reportedAt }),
    },
  );
}

export function openDispute(input: {
  conversationId: string;
  debtRef: string;
  reasonCode: string;
  description?: string;
  idempotencyKey: string;
}) {
  return requestJson<{
    dispute: { id: string; reasonCode: string; status: "PENDING_REVIEW" };
  }>(
    `/api/v1/public/conversations/${encodeURIComponent(input.conversationId)}/debts/${encodeURIComponent(input.debtRef)}/disputes`,
    {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({
        reasonCode: input.reasonCode,
        ...(input.description ? { description: input.description } : {}),
      }),
    },
  );
}
