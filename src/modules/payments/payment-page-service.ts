import type { OfferTerms, VerifiedDebtorContext } from "@/modules/debt-provider/debt-provider.types";
import type { DebtProvider } from "@/modules/debt-provider/debt-provider";
import type { PersistedConversation } from "@/modules/conversations/persistence.types";
import type { InstrumentResponse } from "@/modules/conversations/acceptance.schemas";
import { verifiedDebtorContextSchema } from "@/modules/conversations/debt.schemas";
import { hashSessionToken } from "@/shared/auth/session-token";
import { ApplicationError } from "@/shared/errors/application-error";

import type { PaymentContextStore } from "./payment-context-store";
import type { PaymentProvider } from "./payment-provider";

export type PublicPaymentContext = Readonly<{
  creditorName: string;
  debtDescription: string;
  debtStatus: "OPEN" | "DISPUTED" | "PAID";
  debtDueDate: string;
  terms: OfferTerms;
  offerKind: "CASH" | "INSTALLMENT";
  offerExpiresAt: string;
  acceptedAt: string;
}>;

export class PaymentPageService {
  constructor(
    private readonly store: PaymentContextStore,
    private readonly provider: DebtProvider,
    private readonly paymentProvider: PaymentProvider,
    private readonly sessionSecret: string,
    private readonly sessionMaxAgeSeconds: number,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getContext(input: { slug: string; token: string | undefined; requestId: string }) {
    const authenticated = await this.authenticate(input.slug, input.token);
    const { conversation } = authenticated;
    const debtor = this.requireVerified(conversation);
    const acceptance = await this.store.findLatestAcceptance(conversation);
    if (!acceptance) throw new ApplicationError("ACCEPTANCE_REQUIRED", "Confirme uma proposta antes de acessar esta página.", 409);
    const organization = { organizationId: conversation.organizationId, requestId: input.requestId };
    const [debt, offer] = await Promise.all([
      this.provider.getDebt(organization, debtor, acceptance.debtRef),
      this.provider.getAuthorizedOffer(organization, debtor, acceptance.offerRef),
    ]);
    if (offer.debtRef !== debt.debtRef || offer.debtorRef !== debt.debtorRef || offer.creditorRef !== debt.creditor.creditorRef || offer.providerVersion !== acceptance.providerVersion || JSON.stringify(offer.terms) !== JSON.stringify(acceptance.termsSnapshot)) {
      throw new ApplicationError("PAYMENT_CONTEXT_INVALID", "Não foi possível validar as condições aceitas.", 409);
    }
    return {
      creditorName: debt.creditor.displayName,
      debtDescription: debt.description,
      debtStatus: debt.status,
      debtDueDate: debt.dueDate,
      terms: offer.terms,
      offerKind: offer.terms.kind,
      offerExpiresAt: offer.expiresAt,
      acceptedAt: acceptance.acceptedAt.toISOString(),
    } satisfies PublicPaymentContext;
  }

  async createInstrument(input: { slug: string; token: string | undefined; type: "DEMO_PIX" | "DEMO_BOLETO" | "DEMO_LINK"; idempotencyKey: string; requestId: string }): Promise<InstrumentResponse> {
    const authenticated = await this.authenticate(input.slug, input.token);
    this.requireVerified(authenticated.conversation);
    const acceptance = await this.store.findLatestAcceptance(authenticated.conversation);
    if (!acceptance) throw new ApplicationError("ACCEPTANCE_REQUIRED", "Confirme uma proposta antes de gerar o instrumento demonstrativo.", 409);
    return this.paymentProvider.createDemonstrativeInstrument({
      conversationReference: authenticated.conversation.publicReference,
      sessionToken: input.token!,
      acceptanceReference: acceptance.publicReference,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId,
    });
  }

  private async authenticate(slug: string, token: string | undefined) {
    if (!token) throw new ApplicationError("SESSION_REQUIRED", "Inicie a conversa e confirme uma proposta antes de continuar.", 401);
    const result = await this.store.authenticateBySession(hashSessionToken(token, this.sessionSecret), new Date(this.now().getTime() - this.sessionMaxAgeSeconds * 1_000));
    if (!result || result.organizationSlug !== slug) throw new ApplicationError("SESSION_INVALID", "A sessão não é válida para esta demonstração.", 401);
    return result;
  }

  private requireVerified(conversation: PersistedConversation): VerifiedDebtorContext {
    if (conversation.endedAt || conversation.optedOutAt || conversation.state === "CLOSED" || conversation.state === "OPTED_OUT") throw new ApplicationError("CONVERSATION_TERMINAL", "Esta conversa não permite novas operações.", 409);
    if (conversation.identityStatus !== "VERIFIED" || !conversation.verifiedDebtorContext) throw new ApplicationError("IDENTITY_VERIFICATION_REQUIRED", "Confirme sua identidade antes de continuar.", 403);
    return verifiedDebtorContextSchema.parse(conversation.verifiedDebtorContext);
  }
}
