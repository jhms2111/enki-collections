import { z } from "zod";

export const providerReferenceSchema = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);

export const verifiedDebtorContextSchema = z.object({
  verificationRef: providerReferenceSchema,
  authorizedAccounts: z
    .array(
      z.object({
        debtorRef: providerReferenceSchema,
        creditorRef: providerReferenceSchema,
      }),
    )
    .min(1)
    .max(20),
});
