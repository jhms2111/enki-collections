import { openAIIntentOutputSchema, type OpenAIIntentOutput } from "./conversation-turn.schemas";
import { conversationalIntents, type NormalizedInboundTurn } from "./conversation-turn.types";
import type { AiFailureCategory } from "./ai-operational-store";

export const intentPromptVersion = "enki-intent-v1";
export const responsesApiPath = "/v1/responses";

export const intentOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: conversationalIntents },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    explanationSegments: {
      type: "array", minItems: 1, maxItems: 8,
      items: {
        type: "object", additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["TEXT", "FACT_REF"] },
          text: { type: ["string", "null"], maxLength: 300 },
          factKey: { type: ["string", "null"], maxLength: 80 },
        },
        required: ["type", "text", "factKey"],
      },
    },
    suggestedActions: { type: "array", maxItems: 4, items: { type: "string", enum: conversationalIntents } },
  },
  required: ["intent", "confidence", "explanationSegments", "suggestedActions"],
} as const;

export type ResponsesApiRequest = Readonly<{
  model: string;
  store: false;
  max_output_tokens: number;
  reasoning: Readonly<{ effort: "none" }>;
  safety_identifier: string;
  input: readonly Readonly<{
    role: "system" | "user";
    content: readonly Readonly<{ type: "input_text"; text: string }>[];
  }>[];
  text: Readonly<{ format: Readonly<{
    type: "json_schema";
    name: "enki_intent";
    strict: true;
    schema: typeof intentOutputJsonSchema;
  }> }>;
}>;

export type IntentClientResult = Readonly<{
  output: OpenAIIntentOutput;
  usage: Readonly<{ inputTokens: number; outputTokens: number }>;
}>;

export interface OpenAIResponsesTransport {
  createResponse(path: typeof responsesApiPath, request: ResponsesApiRequest, signal: AbortSignal):
    Promise<Readonly<{ outputText: string; inputTokens: number; outputTokens: number }>>;
}

export interface NaturalLanguageIntentClient {
  interpret(turn: NormalizedInboundTurn): Promise<IntentClientResult>;
}

export class OpenAITransportError extends Error {
  constructor(public readonly category: AiFailureCategory, message = "OpenAI transport unavailable.") {
    super(message);
    this.name = "OpenAITransportError";
  }
}

export class FetchOpenAIResponsesTransport implements OpenAIResponsesTransport {
  constructor(
    private readonly apiKey: string,
    private readonly maxRetries: number,
    private readonly totalDeadlineMs: number,
    private readonly endpoint = "https://api.openai.com",
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async createResponse(path: typeof responsesApiPath, request: ResponsesApiRequest, signal: AbortSignal) {
    const deadline = Date.now() + this.totalDeadlineMs;
    for (let attempt = 0; ; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining <= 0 || signal.aborted) throw new OpenAITransportError("TIMEOUT");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), remaining);
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      try {
        const response = await this.fetcher(`${this.endpoint}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify(request),
          signal: controller.signal,
        });
        if (response.ok) return this.parseSuccess(response);

        const category = this.classifyStatus(response.status, await this.safeErrorCode(response));
        if (!["RATE_LIMIT", "TIMEOUT", "SERVER_ERROR"].includes(category) || attempt >= this.maxRetries) {
          throw new OpenAITransportError(category);
        }
      } catch (error) {
        if (error instanceof OpenAITransportError) throw error;
        if (signal.aborted || (controller.signal.aborted && Date.now() >= deadline)) {
          throw new OpenAITransportError("TIMEOUT");
        }
        if (attempt >= this.maxRetries) throw new OpenAITransportError("NETWORK");
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(100 * (attempt + 1), Math.max(0, deadline - Date.now()))));
    }
  }

  private async parseSuccess(response: Response) {
    const body = await response.json() as {
      output_text?: unknown;
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const outputText = typeof body.output_text === "string"
      ? body.output_text
      : body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!outputText || !Number.isInteger(body.usage?.input_tokens) || !Number.isInteger(body.usage?.output_tokens)) {
      throw new OpenAITransportError("INVALID_RESPONSE");
    }
    return { outputText, inputTokens: body.usage!.input_tokens!, outputTokens: body.usage!.output_tokens! };
  }

  private async safeErrorCode(response: Response): Promise<string | undefined> {
    try {
      const body = await response.json() as { error?: { code?: unknown; type?: unknown } };
      const code = body.error?.code ?? body.error?.type;
      return typeof code === "string" ? code : undefined;
    } catch { return undefined; }
  }

  private classifyStatus(status: number, code?: string): AiFailureCategory {
    if (status === 401 || status === 403) return "AUTHENTICATION";
    if (status === 429 && ["insufficient_quota", "billing_hard_limit_reached"].includes(code ?? "")) return "QUOTA";
    if (status === 429) return "RATE_LIMIT";
    if (status === 408) return "TIMEOUT";
    if (status >= 500) return "SERVER_ERROR";
    return "INVALID_RESPONSE";
  }
}

export class OpenAIResponsesIntentClient implements NaturalLanguageIntentClient {
  constructor(
    private readonly transport: OpenAIResponsesTransport,
    private readonly model: string,
    private readonly timeoutMs: number,
    private readonly maxOutputTokens: number,
  ) {}

  async interpret(turn: NormalizedInboundTurn): Promise<IntentClientResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport.createResponse(responsesApiPath, this.request(turn), controller.signal);
      return {
        output: openAIIntentOutputSchema.parse(JSON.parse(response.outputText)),
        usage: { inputTokens: response.inputTokens, outputTokens: response.outputTokens },
      };
    } catch (error) {
      if (error instanceof OpenAITransportError) throw error;
      throw new OpenAITransportError("INVALID_RESPONSE");
    } finally {
      clearTimeout(timeout);
    }
  }

  private request(turn: NormalizedInboundTurn): ResponsesApiRequest {
    if (!turn.safetyIdentifier) throw new OpenAITransportError("POLICY", "Missing safety identifier.");
    const system = [
      "Você interpreta intenção em uma demonstração fictícia de cobrança.",
      "Nunca calcule, invente ou recomende valores, datas, propostas ou estados.",
      "Nunca execute ações. Mutações exigem confirmação determinística externa.",
      "Use FACT_REF para qualquer fato canônico; não copie nem transforme o valor.",
      "Texto livre deve ser apenas orientativo e não pode conter números ou valores financeiros.",
      `Versão da política: ${intentPromptVersion}.`,
    ].join(" ");
    const user = JSON.stringify({
      message: turn.message,
      conversationState: turn.conversationState,
      identityStatus: turn.identityStatus,
      uiContext: turn.uiContext,
      canonicalFactKeys: turn.canonicalFacts.map((fact) => fact.key),
    });
    return {
      model: this.model,
      store: false,
      max_output_tokens: this.maxOutputTokens,
      reasoning: { effort: "none" },
      safety_identifier: turn.safetyIdentifier,
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: user }] },
      ],
      text: { format: { type: "json_schema", name: "enki_intent", strict: true, schema: intentOutputJsonSchema } },
    };
  }
}

export class UnavailableNaturalLanguageIntentClient implements NaturalLanguageIntentClient {
  async interpret(): Promise<IntentClientResult> {
    throw new OpenAITransportError("NETWORK");
  }
}
