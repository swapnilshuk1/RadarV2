import { describe, expect, it } from "vitest";
import { GeminiAdcStructuredExtractionClient } from "../../../scripts/extraction-comparison/GeminiAdcTransport";
import { LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION, type LlmStructuredRequest } from "../../../src/lib/intelligence/extraction/LlmExperimentalExtractionProvider";

const request: LlmStructuredRequest = {
  kind: "ROLE_INTELLIGENCE", model: "gemini-2.5-flash", prompt: "source", responseSchema: { type: "object" }, cacheKey: "cache-key", sourceIdentity: "immutable-source", generationParameters: { temperature: 0 }, store: false,
};

describe("Batch 04 Gemini ADC comparison transport", () => {
  it("translates the frozen strict structured request without carrying credentials into artifacts", async () => {
    let received: RequestInit | undefined;
    const transport = new GeminiAdcStructuredExtractionClient({
      projectId: "test-project", location: "us-central1", timeoutMs: 1_000, maxTransportRetries: 0,
      tokenProvider: async () => "test-token",
      fetchImpl: async (_url, init) => {
        received = init;
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ schemaVersion: LLM_EXPERIMENT_RESPONSE_SCHEMA_VERSION, output: { proposals: [] } }) }] } }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2, totalTokenCount: 5 } }), { status: 200 });
      },
    });
    const response = await transport.generate(request);
    expect(response.outputText).toContain("proposals");
    expect(response.usage).toEqual({ inputTokens: 3, outputTokens: 2, totalTokens: 5 });
    expect(JSON.stringify(received?.body)).toContain("responseJsonSchema");
    expect(JSON.stringify(transport.attempts)).not.toContain("test-token");
  });

  it("retains a failed transport attempt distinctly from semantic provider output", async () => {
    const transport = new GeminiAdcStructuredExtractionClient({
      projectId: "test-project", location: "us-central1", timeoutMs: 1_000, maxTransportRetries: 0,
      tokenProvider: async () => "test-token", fetchImpl: async () => new Response("quota", { status: 429 }),
    });
    await expect(transport.generate(request)).rejects.toThrow("HTTP 429");
    expect(transport.attempts).toHaveLength(1);
    expect(transport.attempts[0]).toMatchObject({ status: 429, transportRetry: 0 });
  });
});
