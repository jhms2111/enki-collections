import { z } from "zod";

import { providerReferenceSchema } from "./debt.schemas";

const moneySchema = z.object({
  amountInCents: z.number().int().positive(),
  currency: z.literal("BRL"),
});

export const offerTermsSchema = z.object({
  kind: z.enum(["CASH", "INSTALLMENT"]),
  total: moneySchema,
  downPayment: moneySchema,
  installmentCount: z.number().int().positive().max(120),
  installmentAmount: moneySchema,
  firstDueDate: z.iso.date(),
});

export const offerAcceptanceSchema = z.object({
  confirmation: z.literal(true),
  expectedProviderVersion: providerReferenceSchema,
  expectedTerms: offerTermsSchema,
});

export const paymentInstrumentSchema = z.object({
  type: z.enum(["DEMO_LINK", "DEMO_BOLETO", "DEMO_PIX"]),
});

export const idempotencyHeaderSchema = z
  .string()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]+$/);

export const acceptanceReferenceSchema = z
  .string()
  .regex(/^accept_[a-f0-9]{32}$/);

export const acceptanceResponseSchema = z.object({
  acceptance: z.object({
    id: acceptanceReferenceSchema,
    debtRef: providerReferenceSchema,
    offerRef: providerReferenceSchema,
    providerVersion: providerReferenceSchema,
    acceptedAt: z.iso.datetime(),
  }),
});

export const instrumentResponseSchema = z.object({
  instrument: z.object({
    type: z.enum(["DEMO_LINK", "DEMO_BOLETO", "DEMO_PIX"]),
    displayValue: z.string().min(1).max(500),
    expiresAt: z.iso.datetime(),
    isDemo: z.literal(true),
    warning: z.literal("DEMONSTRAÇÃO — SEM VALOR FINANCEIRO"),
  }),
});

export type AcceptanceResponse = z.infer<typeof acceptanceResponseSchema>;
export type InstrumentResponse = z.infer<typeof instrumentResponseSchema>;
