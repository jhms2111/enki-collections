import { z } from "zod";
import { demoIdentifierPattern } from "@/shared/demo/demo-identifier";

export const organizationSlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const conversationReferenceSchema = z
  .string()
  .min(20)
  .max(80)
  .regex(/^conv_[a-f0-9]{32}$/);

export const demoIdentifierSchema = z.object({
  demoIdentifier: z
    .string()
    .trim()
    .regex(demoIdentifierPattern)
    .max(48),
});

export const identityVerificationSchema = z.object({
  optionRef: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
});

export const publicIdentityChallengeSchema = z.object({
  prompt: z.string().min(1).max(500),
  options: z
    .array(
      z.object({
        optionRef: z
          .string()
          .min(3)
          .max(80)
          .regex(/^[a-z0-9-]+$/),
        label: z.string().min(1).max(160),
      }).strict(),
    )
    .min(2)
    .max(10),
  attemptsRemaining: z.number().int().min(0).max(10),
}).strict();

export const terminalConversationCommandSchema = z
  .object({ confirmation: z.literal(true) })
  .strict();
