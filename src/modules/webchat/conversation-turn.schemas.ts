import { z } from "zod";

import { conversationalIntents } from "./conversation-turn.types";
import { providerReferenceSchema } from "@/modules/conversations/debt.schemas";

export const conversationTurnRequestSchema = z
  .object({
    message: z.string().trim().min(1).max(160),
    clientTurnId: z.string().uuid(),
    uiContext: z.enum([
      "IDENTITY",
      "DEBT_LIST",
      "DEBT_DETAIL",
      "OFFER_REVIEW",
      "ACCEPTED",
    ]),
    selectedDebtRef: providerReferenceSchema.optional(),
    selectedOfferRef: providerReferenceSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.selectedOfferRef && !value.selectedDebtRef) {
      context.addIssue({
        code: "custom",
        path: ["selectedOfferRef"],
        message: "A proposta exige uma dívida selecionada.",
      });
    }
  });

export const conversationTurnPublicResponseSchema = z
  .object({
    intent: z.enum(conversationalIntents),
    message: z.string().min(1).max(1_200),
    suggestedActions: z.array(z.enum(conversationalIntents)).max(4),
    requiresConfirmation: z.boolean(),
    fallbackUsed: z.boolean(),
    quickReplies: z.array(z.string().min(1).max(80)).max(2).optional(),
  })
  .strict();

const explanationSegmentSchema = z
  .object({
    type: z.enum(["TEXT", "FACT_REF"]),
    text: z.string().max(300).nullable(),
    factKey: z.string().max(80).nullable(),
  })
  .strict()
  .superRefine((segment, context) => {
    if (segment.type === "TEXT" && (segment.text === null || segment.factKey !== null)) {
      context.addIssue({ code: "custom", message: "Segmento TEXT inválido." });
    }
    if (segment.type === "FACT_REF" && (segment.factKey === null || segment.text !== null)) {
      context.addIssue({ code: "custom", message: "Segmento FACT_REF inválido." });
    }
  });

export const openAIIntentOutputSchema = z
  .object({
    intent: z.enum(conversationalIntents),
    confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
    explanationSegments: z.array(explanationSegmentSchema).min(1).max(8),
    suggestedActions: z.array(z.enum(conversationalIntents)).max(4),
  })
  .strict();

export type OpenAIIntentOutput = z.infer<typeof openAIIntentOutputSchema>;
