import { z } from "zod";

import { conversationalIntents } from "./conversation-turn.types";

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
