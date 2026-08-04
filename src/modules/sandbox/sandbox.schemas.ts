import { z } from "zod";

const forbiddenPersonalData = /(?:\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11,14}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4})/;
const safeText = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine((value) => !forbiddenPersonalData.test(value), {
    message: "O campo parece conter dado pessoal real.",
  });
const ref = z.string().trim().min(3).max(160).regex(/^[a-z0-9][a-z0-9-]*$/i);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const cents = z.number().int().min(1).max(100_000_000);

export const sandboxOfferInputSchema = z.object({
  offerRef: ref,
  kind: z.enum(["CASH", "INSTALLMENT"]),
  totalAmountInCents: cents,
  downPaymentAmountInCents: z.number().int().min(0).max(100_000_000),
  installmentCount: z.number().int().min(1).max(120),
  installmentAmountInCents: cents,
  firstDueDate: dateOnly,
  expiresAt: z.string().datetime({ offset: true }),
  status: z.enum(["AVAILABLE", "EXPIRED", "DISABLED"]).default("AVAILABLE"),
}).strict();

export const sandboxScenarioInputSchema = z.object({
  demoConfirmation: z.literal(true),
  profile: z.object({
    profileRef: ref,
    demoIdentifier: z.string().trim().regex(/^DEMO-[A-Z0-9][A-Z0-9-]{2,31}$/),
    maskedDisplayName: safeText(3, 80),
  }).strict(),
  challenge: z.object({
    challengeRef: ref,
    prompt: safeText(10, 200),
    correctOptionRef: ref,
    options: z.array(z.object({ optionRef: ref, label: safeText(1, 60) }).strict()).min(2).max(5),
  }).strict(),
  creditor: z.object({ creditorRef: ref, displayName: safeText(3, 100) }).strict(),
  debtor: z.object({ debtorRef: ref }).strict(),
  debt: z.object({
    debtRef: ref,
    description: safeText(3, 160),
    amountInCents: cents,
    dueDate: dateOnly,
    status: z.enum(["OPEN", "DISPUTED", "PAID"]).default("OPEN"),
  }).strict(),
  offers: z.array(sandboxOfferInputSchema).min(1).max(10),
}).strict().superRefine((value, context) => {
  const refs = value.challenge.options.map((option) => option.optionRef);
  if (new Set(refs).size !== refs.length) {
    context.addIssue({ code: "custom", path: ["challenge", "options"], message: "As opções devem possuir referências únicas." });
  }
  if (!refs.includes(value.challenge.correctOptionRef)) {
    context.addIssue({ code: "custom", path: ["challenge", "correctOptionRef"], message: "A resposta correta deve referenciar uma opção existente." });
  }
  const offerRefs = value.offers.map((offer) => offer.offerRef);
  if (new Set(offerRefs).size !== offerRefs.length) {
    context.addIssue({ code: "custom", path: ["offers"], message: "As propostas devem possuir referências únicas." });
  }
});

export const sandboxScenarioStatusSchema = z.object({
  active: z.boolean(),
  demoConfirmation: z.literal(true),
}).strict();

export type SandboxScenarioInput = z.infer<typeof sandboxScenarioInputSchema>;
