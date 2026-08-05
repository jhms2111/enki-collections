import { openAIIntentOutputSchema, type OpenAIIntentOutput } from "./conversation-turn.schemas";
import { conversationalIntents, type NormalizedInboundTurn } from "./conversation-turn.types";

export const intentPromptVersion = "enki-intent-v1";
export const responsesApiPath = "/v1/responses";

export const intentOutputJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: { type: "string", enum: conversationalIntents },
    confidence: { type: "string", enum: ["HIGH", "MEDIUM", "LOW"] },
    explanationSegments: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          type: { type: "string", enum: ["TEXT", "FACT_REF"] },
          text: { type: ["string", "null"], maxLength: 300 },
          factKey: { type: ["string", "null"], maxLength: 80 },
        },
        required: ["type", "text", "factKey"],
      },
    },
    suggestedActions: {
      type: "array",
      maxItems: 4,
      items: { type: "string", enum: conversationalIntents },
    },
  },
  required: ["intent", "confidence", "explanationSegments", "suggestedActions"],
} as const;

export type ResponsesApiRequest = Readonly<{
  model: string;
  store: false;
  max_output_tokens: number;
  input: readonly Readonly<{
    role: "system" | "user";
    content: readonly Readonly<{ type: "input_text"; text: string }>[];
  }>[];
  text: Readonly<{
    format: Readonly<{
      type: "json_schema";
      name: "enki_intent";
      strict: true;
      schema: typeof intentOutputJsonSchema;
    }>;
  }>;
}>;

export type IntentClientResult = Readonly<{
  output: OpenAIIntentOutput;
  usage: Readonly<{ inputTokens: number; outputTokens: number }>;
}>;

export interface OpenAIResponsesTransport {
  createResponse(
    path: typeof responsesApiPath,
    request: ResponsesApiRequest,
    signal: AbortSignal,
  ): Promise<Readonly<{ outputText: string; inputTokens: number; outputTokens: number }>>;
}

export interface NaturalLanguageIntentClient {
  interpret(turn: NormalizedInboundTurn): Promise<IntentClientResult>;
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
        this.request(turn),
        controller.signal,
      );
      return {
        output: openAIIntentOutputSchema.parse(JSON.parse(response.outputText)),
        usage: {
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
        },
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private request(turn: NormalizedInboundTurn): ResponsesApiRequest {
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
      input: [
        { role: "system", content: [{ type: "input_text", text: system }] },
        { role: "user", content: [{ type: "input_text", text: user }] },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "enki_intent",
          strict: true,
          schema: intentOutputJsonSchema,
        },
      },
    };
  }
}

export class UnavailableNaturalLanguageIntentClient implements NaturalLanguageIntentClient {
  async interpret(): Promise<IntentClientResult> {
    throw new Error("Natural language client unavailable.");
  }
}
