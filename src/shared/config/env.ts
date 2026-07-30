import { z } from "zod";

const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().url(),
  CONVERSATION_SESSION_SECRET: z.string().min(32),
  ADMIN_DEMO_SECRET: z.string().min(32).optional(),
  CHAT_MAX_MESSAGE_LENGTH: z.coerce.number().int().positive().default(1_200),
  IDENTITY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  SESSION_COOKIE_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(3_600),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;

let cachedEnv: RuntimeEnv | undefined;

export function getRuntimeEnv(
  source: NodeJS.ProcessEnv = process.env,
): RuntimeEnv {
  if (source === process.env && cachedEnv) {
    return cachedEnv;
  }

  const parsed = runtimeEnvSchema.parse(source);

  if (source === process.env) {
    cachedEnv = parsed;
  }

  return parsed;
}
