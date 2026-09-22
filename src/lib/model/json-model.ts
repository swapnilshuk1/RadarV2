import { createHash, randomUUID } from "node:crypto";
import {
  modelRequestFingerprint,
  withProviderConcurrency,
  type ModelCallMetadata,
  type ModelInvocationSink,
  type ModelUsage,
} from "./model-invocation";
import {
  ModelInvalidOutputError,
  ModelProviderUnavailableError,
  clearTransientProviderBackoff,
  nextTransientProviderBackoff,
  providerRetryAfterMs,
} from "./provider-unavailable";

/** Model transport is injectable: extraction/narration do not depend on one vendor. */
export interface JsonModel {
  readonly id: string;
  readonly version: string;
  readonly schemaFormat?: "openapi" | "json-schema";
  generate(
    instruction: string,
    input: unknown,
    responseSchema?: Record<string, unknown>,
    metadata?: ModelCallMetadata,
  ): Promise<unknown>;
}

export class GeminiJsonModel implements JsonModel {
  readonly id = "vertex-gemini";
  readonly version: string;
  readonly schemaFormat: "openapi" | "json-schema";
  readonly configurationFingerprint: string;
  lastUsage:
    | {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
        thoughtsTokenCount?: number;
        totalTokenCount?: number;
        cachedContentTokenCount?: number;
      }
    | undefined;

  constructor(
    private projectId: string,
    private token: () => Promise<string>,
    private request: typeof fetch = fetch,
    private options: {
      model?: string;
      maxOutputTokens?: number;
      temperature?: number;
      timeoutMs?: number;
      thinkingLevel?: "LOW" | "MEDIUM" | "HIGH";
      location?: "us-central1" | "global";
      schemaFormat?: "openapi" | "json-schema";
      invocationSink?: ModelInvocationSink;
      providerConcurrencyLimit?: number;
    } = {},
  ) {
    this.version = options.model ?? "gemini-2.5-flash";
    this.schemaFormat = options.schemaFormat ?? "openapi";
    this.configurationFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          projectId,
          model: this.version,
          location: options.location ?? "us-central1",
          schemaFormat: this.schemaFormat,
          maxOutputTokens: options.maxOutputTokens ?? 8192,
          temperature: options.temperature ?? 0,
          thinkingLevel: options.thinkingLevel ?? "MEDIUM",
        }),
      )
      .digest("hex");
    if (!/^[a-z0-9.-]+$/.test(this.version))
      throw new Error("Valid Vertex model identifier required");
    if (!/^[a-z][a-z0-9-]+$/.test(projectId))
      throw new Error("Explicit Google Cloud project required");
  }

  async generate(
    instruction: string,
    input: unknown,
    responseSchema?: Record<string, unknown>,
    metadata?: ModelCallMetadata,
  ): Promise<unknown> {
    this.lastUsage = undefined;
    const location = this.options.location ?? "us-central1";
    const host =
      location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
    const maxOutputTokens = metadata?.maxOutputTokens ?? this.options.maxOutputTokens ?? 8192;
    const invocationId = randomUUID();
    const startedAt = Date.now();
    const requestFingerprint = modelRequestFingerprint(instruction, input, responseSchema, {
      ...metadata,
      maxOutputTokens,
    });
    let usage: ModelUsage | undefined;
    let finishReason: string | undefined;

    const record = async (
      status: "running" | "completed" | "provider_error" | "transport_error" | "invalid_output",
      errorCode?: string,
    ) => {
      await this.options.invocationSink?.({
        invocationId,
        provider: "vertex-gemini",
        modelId: this.id,
        modelVersion: this.version,
        modelConfigurationFingerprint: this.configurationFingerprint,
        requestFingerprint,
        stage: metadata?.stage ?? "unspecified",
        attempt: metadata?.attempt ?? 1,
        maxOutputTokens,
        startedAt,
        completedAt: status === "running" ? undefined : Date.now(),
        finishReason,
        status,
        errorCode,
        usage,
      });
    };

    await record("running");

    try {
      const response = await withProviderConcurrency(
        `vertex-gemini:${this.projectId}:${location}`,
        this.options.providerConcurrencyLimit ??
          Number(process.env.RADAR_MODEL_PROVIDER_CONCURRENCY || "6"),
        async () =>
          this.request(
            `https://${host}/v1/projects/${this.projectId}/locations/${location}/publishers/google/models/${this.version}:generateContent`,
            {
              method: "POST",
              signal: AbortSignal.timeout(this.options.timeoutMs ?? 90000),
              headers: {
                Authorization: `Bearer ${await this.token()}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                systemInstruction: { parts: [{ text: instruction }] },
                contents: [{ role: "user", parts: [{ text: JSON.stringify(input) }] }],
                generationConfig: {
                  ...(this.version.startsWith("gemini-3")
                    ? {}
                    : { temperature: this.options.temperature ?? 0 }),
                  responseMimeType: "application/json",
                  ...(responseSchema
                    ? {
                        [this.schemaFormat === "json-schema"
                          ? "responseJsonSchema"
                          : "responseSchema"]: responseSchema,
                      }
                    : {}),
                  maxOutputTokens,
                  ...(this.version.startsWith("gemini-3")
                    ? { thinkingConfig: { thinkingLevel: this.options.thinkingLevel ?? "MEDIUM" } }
                    : { thinkingConfig: { thinkingBudget: 0 } }),
                },
              }),
            },
          ),
      );

      const backoffKey = `vertex-gemini:${this.configurationFingerprint}`;
      const delay = !response.ok ? await providerRetryAfterMs(response) : undefined;
      if (!response.ok) {
        const transient = response.status === 429 || response.status >= 500;
        if (!transient) clearTransientProviderBackoff(backoffKey);
        throw new ModelProviderUnavailableError(
          `Model provider HTTP ${response.status}`,
          response.status,
          transient ? nextTransientProviderBackoff(backoffKey, delay) : delay,
        );
      }

      clearTransientProviderBackoff(backoffKey);
      const payload = (await response.json()) as {
        usageMetadata?: GeminiJsonModel["lastUsage"];
        candidates?: Array<{
          finishReason?: string;
          content?: { parts?: Array<{ text?: string; thought?: boolean }> };
        }>;
      };
      this.lastUsage = payload.usageMetadata;
      usage = payload.usageMetadata
        ? {
            inputTokens: payload.usageMetadata.promptTokenCount,
            outputTokens: payload.usageMetadata.candidatesTokenCount,
            reasoningTokens: payload.usageMetadata.thoughtsTokenCount,
            totalTokens: payload.usageMetadata.totalTokenCount,
            cachedInputTokens: payload.usageMetadata.cachedContentTokenCount,
          }
        : undefined;
      const candidate = payload.candidates?.[0];
      finishReason = candidate?.finishReason;
      if (candidate?.finishReason !== "STOP") {
        const error = new ModelInvalidOutputError(
          `Model output incomplete: ${candidate?.finishReason ?? "EMPTY"}`,
        );
        await record("invalid_output", error.message);
        throw error;
      }

      const raw =
        candidate.content?.parts
          ?.filter((part) => !part.thought)
          .map((part) => part.text ?? "")
          .join("") ?? "";
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const error = new ModelInvalidOutputError("Model returned invalid JSON");
        await record("invalid_output", "INVALID_JSON");
        throw error;
      }
      await record("completed");
      return parsed;
    } catch (error) {
      if (error instanceof ModelInvalidOutputError) throw error;
      if (error instanceof ModelProviderUnavailableError) {
        await record("provider_error", error.message);
        throw error;
      }
      await record("transport_error", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}