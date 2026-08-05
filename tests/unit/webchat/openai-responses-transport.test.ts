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
});
