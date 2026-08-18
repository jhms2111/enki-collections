import { z } from "zod";

import { instrumentResponseSchema } from "@/modules/conversations/acceptance.schemas";

export const paymentPageInstrumentRequestSchema = z.object({
  type: z.enum(["DEMO_PIX", "DEMO_BOLETO", "DEMO_LINK"]),
  confirmationText: z.literal("CONFIRMO O INSTRUMENTO"),
}).strict();

export const paymentPageInstrumentResponseSchema = instrumentResponseSchema;

export type PaymentPageInstrumentRequest = z.infer<typeof paymentPageInstrumentRequestSchema>;
