import { describe, expect, it, vi } from "vitest";

import { FetchOpenAIResponsesTransport, type ResponsesApiRequest } from "@/modules/webchat/openai-responses-intent-client";

const request = {
  model: "gpt-5.6-luna", store: false, max_output_tokens: 100,
  reasoning: { effort: "none" }, safety_identifier: "opaque-pseudonym",
  input: [{ role: "user", content: [{ type: "input_text", text: "fictício" }] }],
  text: { format: { type: "json_schema", name: "enki_intent", strict: true, schema: {} } },
} as unknown as ResponsesApiRequest;

describe("FetchOpenAIResponsesTransport", () => {
  it("uses the Responses endpoint without tools or persistence", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      expect(body.store).toBe(false);
      expect(body.reasoning).toEqual({ effort: "none" });
      expect(body.max_output_tokens).toBe(100);
      expect(body.text.format).toMatchObject({ type: "json_schema", name: "enki_intent", strict: true });
      expect(body).not.toHaveProperty("tools");
      expect(body).not.toHaveProperty("previous_response_id");
      return new Response(JSON.stringify({ output_text: "{}", usage: { input_tokens: 9, output_tokens: 2 } }), { status: 200 });
    });
    const transport = new FetchOpenAIResponsesTransport("fake-key", 1, 1_000, "https://api.openai.test", fetcher as typeof fetch);
    await expect(transport.createResponse("/v1/responses", request, new AbortController().signal))
      .resolves.toEqual({ outputText: "{}", inputTokens: 9, outputTokens: 2 });
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][0]).toBe("https://api.openai.test/v1/responses");
  });

  it("extracts output_text from the documented output item structure", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "opaque",
      object: "response",
      output: [{ type: "message", content: [{ type: "output_text", text: "{}" }] }],
      usage: { input_tokens: 3, output_tokens: 2 },
    }), { status: 200, headers: { "content-type": "application/json", "x-request-id": "req-safe" } }));
    const transport = new FetchOpenAIResponsesTransport("fake-key", 0, 1_000, "https://api.openai.test", fetcher);
    await expect(transport.createResponse("/v1/responses", request, new AbortController().signal))
      .resolves.toEqual({ outputText: "{}", inputTokens: 3, outputTokens: 2 });
  });

  it("classifies a successful HTTP response with an unreadable body as a parse error", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response("not-json", {
      status: 200,
      headers: { "content-type": "application/json", "x-request-id": "req-safe" },
    }));
    const transport = new FetchOpenAIResponsesTransport("fake-key", 0, 1_000, "https://api.openai.test", fetcher);
    await expect(transport.createResponse("/v1/responses", request, new AbortController().signal)).rejects.toMatchObject({
      category: "RESPONSE_PARSE_ERROR",
      metadata: { httpResponseReceived: true, status: 200, requestId: "req-safe", contentType: "application/json", localErrorName: "SyntaxError" },
    });
  });

  it("reports only safe structural metadata when output_text is absent", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{ type: "message", content: [{ type: "refusal" }] }],
      usage: { input_tokens: 3, output_tokens: 1 },
    }), { status: 200 }));
    const transport = new FetchOpenAIResponsesTransport("fake-key", 0, 1_000, "https://api.openai.test", fetcher);
    await expect(transport.createResponse("/v1/responses", request, new AbortController().signal)).rejects.toMatchObject({
      category: "RESPONSE_PARSE_ERROR",
      metadata: { status: 200, responseKeys: ["output", "usage"], outputItemTypes: ["message"], outputContentTypes: ["refusal"] },
    });
  });

  it("retries one temporary failure and then succeeds", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response("{}", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output_text: "{}", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 }));
    const transport = new FetchOpenAIResponsesTransport("fake-key", 1, 1_000, "https://api.openai.test", fetcher);
    await transport.createResponse("/v1/responses", request, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("never retries authentication or quota failures", async () => {
    for (const response of [
      new Response("{}", { status: 401 }),
      new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 }),
    ]) {
      const fetcher = vi.fn().mockResolvedValue(response);
      const transport = new FetchOpenAIResponsesTransport("fake-key", 1, 1_000, "https://api.openai.test", fetcher);
      await expect(transport.createResponse("/v1/responses", request, new AbortController().signal)).rejects.toBeDefined();
      expect(fetcher).toHaveBeenCalledOnce();
    }
  });

  it.each([
    [404, { error: { type: "invalid_request_error", code: "model_not_found", param: "model" } }, "MODEL_UNAVAILABLE"],
    [400, { error: { type: "invalid_request_error", code: "invalid_value", param: "reasoning.effort" } }, "INVALID_REQUEST"],
  ])("classifies safe API errors without retry", async (status, body, category) => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-request-id": "req-safe" },
    }));
    const transport = new FetchOpenAIResponsesTransport("fake-key", 1, 1_000, "https://api.openai.test", fetcher);
    await expect(transport.createResponse("/v1/responses", request, new AbortController().signal)).rejects.toMatchObject({
      category,
      metadata: {
        status,
        requestId: "req-safe",
        errorType: "invalid_request_error",
        errorParam: status === 404 ? "model" : "reasoning.effort",
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("classifies aborts and network failures after fetch starts as ambiguous outcomes", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    const timeoutFetcher = vi.fn().mockRejectedValue(abortError);
    const timeoutTransport = new FetchOpenAIResponsesTransport("fake-key", 0, 1_000, "https://api.openai.test", timeoutFetcher);
    await expect(timeoutTransport.createResponse("/v1/responses", request, new AbortController().signal)).rejects.toMatchObject({
      category: "UNKNOWN_OUTCOME", metadata: { httpResponseReceived: false, fetchInitiated: true, localErrorName: "AbortError" },
    });

    const networkError = Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
    const networkFetcher = vi.fn().mockRejectedValue(networkError);
    const networkTransport = new FetchOpenAIResponsesTransport("fake-key", 0, 1_000, "https://api.openai.test", networkFetcher);
    await expect(networkTransport.createResponse("/v1/responses", request, new AbortController().signal)).rejects.toMatchObject({
      category: "UNKNOWN_OUTCOME", metadata: { httpResponseReceived: false, fetchInitiated: true, localErrorName: "TypeError", localErrorCode: "ENOTFOUND" },
    });
  });

  it("treats an HTTP timeout response as conclusive", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { type: "request_timeout" } }), { status: 408 }));
    const transport = new FetchOpenAIResponsesTransport("fake-key", 0, 1_000, "https://api.openai.test", fetcher);
    await expect(transport.createResponse("/v1/responses", request, new AbortController().signal)).rejects.toMatchObject({
      category: "TIMEOUT", metadata: { httpResponseReceived: true, status: 408 },
    });
  });
});
