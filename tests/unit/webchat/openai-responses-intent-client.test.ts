import { describe, expect, it } from "vitest";

import {
  intentOutputJsonSchema,
  OpenAIResponsesIntentClient,
  responsesApiPath,
  type OpenAIResponsesTransport,
  type ResponsesApiRequest,
} from "@/modules/webchat/openai-responses-intent-client";
import type { NormalizedInboundTurn } from "@/modules/webchat/conversation-turn.types";

const turn: NormalizedInboundTurn = {
  channel: "WEBCHAT",
  message: "Explique de forma simples",
  conversationState: "IDENTITY_VERIFIED",
  identityStatus: "VERIFIED",
  uiContext: "DEBT_DETAIL",
  safetyIdentifier: "pseudonymous-safety-identifier",
  canonicalFacts: [{ key: "fact_amount", displayText: "SEGREDO-CANÔNICO" }],
};

describe("OpenAIResponsesIntentClient", () => {
  it("builds a strict Responses API request without tools or canonical values", async () => {
    let capturedPath: string | undefined;
    let capturedRequest: ResponsesApiRequest | undefined;
    const transport: OpenAIResponsesTransport = {
      async createResponse(path, request) {
        capturedPath = path;
        capturedRequest = request;
        return {
          outputText: JSON.stringify({
            intent: "HELP",
            confidence: "HIGH",
            explanationSegments: [{ type: "TEXT", text: "Posso orientar pelo menu.", factKey: null }],
            suggestedActions: ["HELP"],
          }),
          inputTokens: 20,
          outputTokens: 8,
        };
      },
    };
    const client = new OpenAIResponsesIntentClient(
      transport,
      "gpt-5.6-luna",
      1_000,
      200,
    );
    await client.interpret(turn);
    expect(capturedPath).toBe(responsesApiPath);
    expect(capturedRequest).toBeDefined();
    const request = capturedRequest!;
    expect(request.model).toBe("gpt-5.6-luna");
    expect(request.store).toBe(false);
    expect(request.reasoning).toEqual({ effort: "none" });
    expect(request.safety_identifier).toBe("pseudonymous-safety-identifier");
    expect(request.text.format).toEqual({
      type: "json_schema",
      name: "enki_intent",
      strict: true,
      schema: intentOutputJsonSchema,
    });
    expect(request).not.toHaveProperty("tools");
    expect(JSON.stringify(request)).toContain("fact_amount");
    expect(JSON.stringify(request)).not.toContain("SEGREDO-CANÔNICO");
  });

  it("rejects malformed or extra output fields", async () => {
    const transport: OpenAIResponsesTransport = {
      async createResponse() {
        return {
          outputText: JSON.stringify({
            intent: "HELP",
            confidence: "HIGH",
            explanationSegments: [{ type: "TEXT", text: "Ajuda.", factKey: null }],
            suggestedActions: [],
            executeMutation: true,
          }),
          inputTokens: 1,
          outputTokens: 1,
        };
      },
    };
    const client = new OpenAIResponsesIntentClient(transport, "configured-model", 1_000, 100);
    await expect(client.interpret(turn)).rejects.toThrow();
  });

  it("aborts a simulated Responses API transport after the configured timeout", async () => {
    const transport: OpenAIResponsesTransport = {
      async createResponse(_path, _request, signal) {
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
    };
    const client = new OpenAIResponsesIntentClient(transport, "configured-model", 5, 100);
    await expect(client.interpret(turn)).rejects.toMatchObject({ category: "INVALID_RESPONSE" });
  });
});
