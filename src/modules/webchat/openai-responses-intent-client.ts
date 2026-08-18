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

export class LazyNaturalLanguageIntentClient implements NaturalLanguageIntentClient {
  private client?: NaturalLanguageIntentClient;

  constructor(private readonly factory: () => NaturalLanguageIntentClient) {}

  interpret(turn: NormalizedInboundTurn): Promise<IntentClientResult> {
    this.client ??= this.factory();
    return this.client.interpret(turn);
  }
}

export function buildOpenAIIntentRequest(
  turn: NormalizedInboundTurn,
  model: string,
  maxOutputTokens: number,
): ResponsesApiRequest {
  if (!turn.safetyIdentifier) throw new OpenAITransportError("POLICY", "Missing safety identifier.");
  const system = [
    "Você interpreta intenção em uma demonstração fictícia de cobrança.",
    "Nunca calcule, invente ou recomende valores, datas, propostas ou estados.",
    "Nunca execute ações. Mutações exigem confirmação determinística externa.",
    "Use FACT_REF para qualquer fato canônico; não copie nem transforme o valor.",
    "Texto livre deve ser apenas orientativo e não pode conter números ou valores financeiros.",
    "Interprete respostas curtas em relação a lastSubject, sem presumir fatos ou executar ações.",
    `Versão da política: ${intentPromptVersion}.`,
  ].join(" ");
  const user = JSON.stringify({
    message: turn.message,
    conversationState: turn.conversationState,
    identityStatus: turn.identityStatus,
    uiContext: turn.uiContext,
    canonicalFactKeys: turn.canonicalFacts.map((fact) => fact.key),
    lastSubject: turn.lastSubject ?? null,
    pendingOperation: turn.pendingOperation,
    allowedActions: turn.allowedActions,
    hasCurrentAcceptance: turn.hasCurrentAcceptance,
  });
  return {
    model,
    store: false,
    max_output_tokens: maxOutputTokens,
    reasoning: { effort: "none" },
    safety_identifier: turn.safetyIdentifier,
    input: [
      { role: "system", content: [{ type: "input_text", text: system }] },
      { role: "user", content: [{ type: "input_text", text: user }] },
    ],
    text: { format: { type: "json_schema", name: "enki_intent", strict: true, schema: intentOutputJsonSchema } },
  };
}

export class OpenAITransportError extends Error {
  constructor(
    public readonly category: AiFailureCategory,
    message = "OpenAI transport unavailable.",
    public readonly metadata: OpenAITransportMetadata = {},
  ) {
    super(message);
    this.name = "OpenAITransportError";
  }
}

export type OpenAITransportMetadata = Readonly<{
  httpResponseReceived?: boolean;
  status?: number;
  requestId?: string;
  contentType?: string;
  errorType?: string;
  errorCode?: string;
  errorParam?: string;
  responseKeys?: readonly string[];
  outputItemTypes?: readonly string[];
  outputContentTypes?: readonly string[];
  localErrorName?: string;
  localErrorCode?: string;
  fetchInitiated?: boolean;
}>;

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

        const metadata = await this.safeErrorMetadata(response);
        const category = this.classifyStatus(response.status, metadata.errorCode ?? metadata.errorType);
        if (!["RATE_LIMIT", "TIMEOUT", "SERVER_ERROR"].includes(category) || attempt >= this.maxRetries) {
          throw new OpenAITransportError(category, undefined, metadata);
        }
      } catch (error) {
        if (error instanceof OpenAITransportError) throw error;
        const local = error as { name?: unknown; code?: unknown; cause?: { code?: unknown } };
        if (signal.aborted || controller.signal.aborted || local.name === "AbortError") {
          throw new OpenAITransportError("UNKNOWN_OUTCOME", undefined, {
            httpResponseReceived: false,
            fetchInitiated: true,
            localErrorName: typeof local.name === "string" ? local.name : undefined,
            localErrorCode: typeof local.code === "string" ? local.code : undefined,
          });
        }
        if (attempt >= this.maxRetries) {
          throw new OpenAITransportError("UNKNOWN_OUTCOME", undefined, {
            httpResponseReceived: false,
            fetchInitiated: true,
            localErrorName: typeof local.name === "string" ? local.name : undefined,
            localErrorCode: typeof local.code === "string" ? local.code
              : typeof local.cause?.code === "string" ? local.cause.code : undefined,
          });
        }
      } finally {
        clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(100 * (attempt + 1), Math.max(0, deadline - Date.now()))));
    }
  }

  private async parseSuccess(response: Response) {
    let body: {
      output_text?: unknown;
      output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    try {
      body = await response.json() as typeof body;
    } catch (error) {
      throw new OpenAITransportError("RESPONSE_PARSE_ERROR", undefined, {
        ...this.responseMetadata(response),
        localErrorName: error instanceof Error ? error.name : undefined,
      });
    }
    const structural = {
      ...this.responseMetadata(response),
      responseKeys: Object.keys(body),
      outputItemTypes: body.output?.map((item) => item.type).filter((value): value is string => typeof value === "string"),
      outputContentTypes: body.output?.flatMap((item) => item.content ?? []).map((item) => item.type).filter((value): value is string => typeof value === "string"),
    };
    const outputText = typeof body.output_text === "string"
      ? body.output_text
      : body.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
    if (!outputText || !Number.isInteger(body.usage?.input_tokens) || !Number.isInteger(body.usage?.output_tokens)) {
      throw new OpenAITransportError("RESPONSE_PARSE_ERROR", undefined, structural);
    }
    return { outputText, inputTokens: body.usage!.input_tokens!, outputTokens: body.usage!.output_tokens! };
  }

  private async safeErrorMetadata(response: Response): Promise<OpenAITransportMetadata> {
    const metadata = this.responseMetadata(response);
    try {
      const body = await response.json() as { error?: { code?: unknown; type?: unknown; param?: unknown } };
      return {
        ...metadata,
        responseKeys: body && typeof body === "object" ? Object.keys(body) : [],
        errorCode: typeof body.error?.code === "string" ? body.error.code : undefined,
        errorType: typeof body.error?.type === "string" ? body.error.type : undefined,
        errorParam: typeof body.error?.param === "string" ? body.error.param : undefined,
      };
    } catch (error) {
      return { ...metadata, localErrorName: error instanceof Error ? error.name : undefined };
    }
  }

  private responseMetadata(response: Response): OpenAITransportMetadata {
    return {
      httpResponseReceived: true,
      status: response.status,
      requestId: response.headers.get("x-request-id") ?? undefined,
      contentType: response.headers.get("content-type") ?? undefined,
    };
  }

  private classifyStatus(status: number, code?: string): AiFailureCategory {
    if (status === 401 || status === 403) return "AUTHENTICATION";
    if (status === 429 && ["insufficient_quota", "billing_hard_limit_reached"].includes(code ?? "")) return "QUOTA";
    if (status === 429) return "RATE_LIMIT";
    if (status === 408) return "TIMEOUT";
    if (status >= 500) return "SERVER_ERROR";
    if (status === 404 && ["model_not_found", "model_unavailable"].includes(code ?? "")) return "MODEL_UNAVAILABLE";
    if ([400, 404, 409, 422].includes(status)) return "INVALID_REQUEST";
    return "RESPONSE_PARSE_ERROR";
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
      const response = await this.transport.createResponse(
        responsesApiPath,
        buildOpenAIIntentRequest(turn, this.model, this.maxOutputTokens),
        controller.signal,
      );
      return {
        output: openAIIntentOutputSchema.parse(JSON.parse(response.outputText)),
        usage: { inputTokens: response.inputTokens, outputTokens: response.outputTokens },
      };
    } catch (error) {
      if (error instanceof OpenAITransportError) throw error;
      throw new OpenAITransportError("INVALID_STRUCTURED_OUTPUT", undefined, {
        localErrorName: error instanceof Error ? error.name : undefined,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

}

export class UnavailableNaturalLanguageIntentClient implements NaturalLanguageIntentClient {
  async interpret(): Promise<IntentClientResult> {
    throw new OpenAITransportError("NETWORK");
  }
}
