import { z } from "zod";

const runtimeEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().url(),
  CONVERSATION_SESSION_SECRET: z.string().min(32),
  IDEMPOTENCY_HMAC_SECRET: z.string().min(64),
  ADMIN_DEMO_SECRET: z.string().min(32).optional(),
  CHAT_MAX_MESSAGE_LENGTH: z.coerce.number().int().positive().default(1_200),
  IDENTITY_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  DEMO_IDENTIFIER_ONLY_ORGANIZATIONS: z.preprocess(
    (value) => value === "" || value === undefined ? [] : String(value).split(",").map((item) => item.trim()).filter(Boolean),
    z.array(z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)).default([]),
  ),
  SESSION_COOKIE_MAX_AGE_SECONDS: z.coerce
    .number()
    .int()
    .min(300)
    .max(86_400)
    .default(3_600),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  OPENAI_ENABLED: z
    .preprocess((value) => value === "" ? undefined : value, z.enum(["true", "false"]).default("false"))
    .transform((value) => value === "true"),
  OPENAI_MODEL: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().trim().min(1).max(80).default("gpt-5.6-luna"),
  ),
  OPENAI_TIMEOUT_MS: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(500).max(10_000).default(10_000),
  ),
  OPENAI_MAX_OUTPUT_TOKENS: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(64).max(1_000).default(200),
  ),
  OPENAI_MAX_INPUT_TOKENS: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(500).max(20_000).default(4_000),
  ),
  OPENAI_API_KEY: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(20).optional(),
  ),
  OPENAI_SAFETY_HMAC_SECRET: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.string().min(64).optional(),
  ),
  OPENAI_MAX_RETRIES: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(0).max(1).default(0),
  ),
  OPENAI_TOTAL_DEADLINE_MS: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(1_000).max(30_000).default(15_000),
  ),
  OPENAI_MAX_CALLS_PER_CONVERSATION: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(1).max(20).default(5),
  ),
  OPENAI_DAILY_BUDGET_USD: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().positive().max(100).default(0.5),
  ),
  OPENAI_MONTHLY_BUDGET_USD: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().positive().max(1_000).default(5),
  ),
  OPENAI_CIRCUIT_FAILURE_THRESHOLD: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(1).max(20).default(5),
  ),
  OPENAI_CIRCUIT_OPEN_SECONDS: z.preprocess(
    (value) => value === "" ? undefined : value,
    z.coerce.number().int().min(10).max(3_600).default(60),
  ),
}).refine(
  (env) =>
    env.IDEMPOTENCY_HMAC_SECRET !== env.CONVERSATION_SESSION_SECRET,
  {
    path: ["IDEMPOTENCY_HMAC_SECRET"],
    message: "O segredo de idempotência deve ser dedicado.",
  },
).superRefine((env, context) => {
  if (env.OPENAI_ENABLED && !env.OPENAI_API_KEY) {
    context.addIssue({ code: "custom", path: ["OPENAI_API_KEY"], message: "OPENAI_API_KEY é obrigatória quando OpenAI está habilitada." });
  }
  if (env.OPENAI_ENABLED && !env.OPENAI_SAFETY_HMAC_SECRET) {
    context.addIssue({ code: "custom", path: ["OPENAI_SAFETY_HMAC_SECRET"], message: "Segredo dedicado de safety_identifier é obrigatório." });
  }
  if (env.OPENAI_SAFETY_HMAC_SECRET && [env.CONVERSATION_SESSION_SECRET, env.IDEMPOTENCY_HMAC_SECRET].includes(env.OPENAI_SAFETY_HMAC_SECRET)) {
    context.addIssue({ code: "custom", path: ["OPENAI_SAFETY_HMAC_SECRET"], message: "O segredo de IA deve ser dedicado." });
  }
  if (env.OPENAI_DAILY_BUDGET_USD > env.OPENAI_MONTHLY_BUDGET_USD) {
    context.addIssue({ code: "custom", path: ["OPENAI_DAILY_BUDGET_USD"], message: "O orçamento diário não pode superar o mensal." });
  }
  if (env.OPENAI_TIMEOUT_MS >= env.OPENAI_TOTAL_DEADLINE_MS) {
    context.addIssue({ code: "custom", path: ["OPENAI_TOTAL_DEADLINE_MS"], message: "O prazo total deve ser maior que o timeout de uma tentativa." });
  }
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
