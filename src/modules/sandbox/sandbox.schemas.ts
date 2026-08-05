import { z } from "zod";

const forbiddenPersonalData = /(?:\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11,14}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|(?:\+?55\s*)?\(?\d{2}\)?\s*9?\d{4}[-\s]?\d{4})/;
const safeText = (min: number, max: number) =>
  z.string().trim().min(min).max(max).refine((value) => !forbiddenPersonalData.test(value), {
    message: "O campo parece conter dado pessoal real.",
  });
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe uma data válida.");
const cents = z.number().int("Informe um valor inteiro em centavos.").min(1).max(100_000_000);

export const sandboxOfferInputSchema = z.object({
  kind: z.enum(["CASH", "INSTALLMENT"]),
  totalAmountInCents: cents,
  downPaymentAmountInCents: z.number().int().min(0).max(100_000_000),
  installmentCount: z.number().int().min(1).max(120),
  installmentAmountInCents: cents,
  firstDueDate: dateOnly,
  expiresAt: z.string().datetime({ offset: true }),
}).strict();

export const sandboxScenarioInputSchema = z.object({
  demoConfirmation: z.literal(true, { error: "Confirme que todos os dados são fictícios." }),
  scenarioName: safeText(3, 100),
  debtor: z.object({ displayName: safeText(3, 80) }).strict(),
  challenge: z.object({
    prompt: safeText(10, 200),
    correctOptionIndex: z.number().int().min(0).max(4),
    options: z.array(z.object({ label: safeText(1, 60) }).strict()).min(2).max(5),
  }).strict(),
  creditor: z.object({ displayName: safeText(3, 100) }).strict(),
  debt: z.object({
    description: safeText(3, 160),
    amountInCents: cents,
    dueDate: dateOnly,
  }).strict(),
  offers: z.array(sandboxOfferInputSchema).min(1).max(10),
}).strict().superRefine((value, context) => {
  if (value.challenge.correctOptionIndex >= value.challenge.options.length) {
    context.addIssue({ code: "custom", path: ["challenge", "correctOptionIndex"], message: "Selecione uma resposta correta existente." });
  }
});

export const sandboxScenarioStatusSchema = z.object({
  active: z.boolean(),
  demoConfirmation: z.literal(true),
}).strict();

export type SandboxScenarioInput = z.infer<typeof sandboxScenarioInputSchema>;
