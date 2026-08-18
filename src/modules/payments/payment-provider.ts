import type { InstrumentResponse } from "@/modules/conversations/acceptance.schemas";
import type { OfferAcceptanceService } from "@/modules/conversations/offer-acceptance-service";

export interface PaymentProvider {
  createDemonstrativeInstrument(input: Readonly<{
    conversationReference: string;
    sessionToken: string;
    acceptanceReference: string;
    type: "DEMO_PIX" | "DEMO_BOLETO" | "DEMO_LINK";
    idempotencyKey: string;
    requestId: string;
  }>): Promise<InstrumentResponse>;
}

export class ExistingDemoPaymentProvider implements PaymentProvider {
  constructor(private readonly acceptanceService: OfferAcceptanceService) {}

  createDemonstrativeInstrument(input: Parameters<PaymentProvider["createDemonstrativeInstrument"]>[0]) {
    return this.acceptanceService.createInstrument({
      publicReference: input.conversationReference,
      token: input.sessionToken,
      acceptanceReference: input.acceptanceReference,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      requestId: input.requestId,
    });
  }
}
