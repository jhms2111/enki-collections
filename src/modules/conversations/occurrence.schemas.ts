import { z } from "zod";

import { providerReferenceSchema } from "./debt.schemas";

export const paymentPromiseSchema = z
  .object({
    promisedDate: z.iso.date(),
    offerRef: providerReferenceSchema.optional(),
  })
  .strict();

export const paymentReportSchema = z
  .object({
    reportedAt: z.iso.datetime(),
  })
  .strict();

export const disputeSchema = z
  .object({
    reasonCode: z.enum([
      "NOT_RECOGNIZED",
      "AMOUNT_INCORRECT",
      "ALREADY_PAID",
      "OTHER",
    ]),
    description: z.string().trim().min(1).max(300).optional(),
  })
  .strict();

export const paymentPromiseResponseSchema = z.object({
  promise: z.object({
    id: z.string().regex(/^promise_[a-f0-9]{32}$/),
    debtRef: providerReferenceSchema,
    promisedDate: z.iso.date(),
    status: z.literal("RECORDED"),
  }),
});

export const paymentReportResponseSchema = z.object({
  report: z.object({
    id: z.string().regex(/^report_[a-f0-9]{32}$/),
    debtRef: providerReferenceSchema,
    reportedAt: z.iso.datetime(),
    receivedAt: z.iso.datetime(),
    status: z.literal("PENDING_REVIEW"),
    warning: z.literal("PAGAMENTO INFORMADO — NÃO CONFIRMADO"),
  }),
});

export const disputeResponseSchema = z.object({
  dispute: z.object({
    id: z.string().regex(/^dispute_[a-f0-9]{32}$/),
    debtRef: providerReferenceSchema,
    reasonCode: z.enum([
      "NOT_RECOGNIZED",
      "AMOUNT_INCORRECT",
      "ALREADY_PAID",
      "OTHER",
    ]),
    status: z.literal("PENDING_REVIEW"),
  }),
});

export type PaymentPromiseResponse = z.infer<
  typeof paymentPromiseResponseSchema
>;
export type PaymentReportResponse = z.infer<
  typeof paymentReportResponseSchema
>;
export type DisputeResponse = z.infer<typeof disputeResponseSchema>;
