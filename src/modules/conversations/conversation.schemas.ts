import { z } from "zod";

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
    .regex(/^DEMO-[A-Z]+-\d{3}$/)
    .max(40),
});

export const identityVerificationSchema = z.object({
  optionRef: z
    .string()
    .trim()
    .min(3)
    .max(80)
    .regex(/^[a-z0-9-]+$/),
});
