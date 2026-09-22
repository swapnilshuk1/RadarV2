import { createHash, randomUUID } from "node:crypto";
import type { JsonModel } from "./json-model";
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

/** Bedrock Mantle Chat Completions adapter. Domain schemas/validators stay authoritative. */
export class BedrockMantleJsonModel implements JsonModel {
  readonly id = "bedrock-mantle";
  readonly schemaFormat = "json-schema" as const;
  readonly configurationFingerprint: string;
  lastUsage:
    | {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        cachedInputTokens?: number;
        reasoningTokens?: number;
      }
    | undefined;

  constructor(
    readonly version: string,
    private readonly apiKey: () => Promise<string>,
    private readonly request: typeof fetch = fetch,
    private readonly options: {
      region?: string;
      timeoutMs?: number;
      stageTimeoutMs?: Readonly<Record<string, number>>;
      maxOutputTokens?: number;
      stageOutputTokens?: Readonly<Record<string, number>>;
      invocationSink?: ModelInvocationSink;
      providerConcurrencyLimit?: number;
      random?: () => number;
    } = {},
  ) {
    this.configurationFingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          transport: "bedrock-mantle-chat-v1",
          model: version,
          region: options.region ?? "us-east-1",
          timeoutMs: options.timeoutMs ?? 120_000,
          stageTimeoutMs: Object.fromEntries(
            Object.entries(options.stageTimeoutMs ?? {}).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          ),
          maxOutputTokens: options.maxOutputTokens ?? 12288,
          stageOutputTokens: Object.fromEntries(
            Object.entries(options.stageOutputTokens ?? {}).sort(([a], [b]) =>
              a.localeCompare(b),
            ),
          ),
          structuredOutput: "json_schema-strict",
        }),
      )
      .digest("hex");
  }

  async generate(
    instruction: string,
    input: unknown,
    responseSchema?: Record<string, unknown>,
    metadata?: ModelCallMetadata,
  ): Promise<unknown> {
    this.lastUsage = undefined;
    const stage = metadata?.stage ?? "unspecified";
    const maxOutputTokens =
      metadata?.maxOutputTokens ??
      this.options.stageOutputTokens?.[stage] ??
      this.options.maxOutputTokens ??
      12288;
    const timeoutMs =
      this.options.stageTimeoutMs?.[stage] ??
      this.options.timeoutMs ??
      120_000;
    const backoffKey = `bedrock-mantle:${this.configurationFingerprint}`;
    const invocationId = randomUUID();
    const startedAt = Date.now();
    const requestFingerprint = modelRequestFingerprint(instruction, input, responseSchema, {
      ...metadata,
      stage,
      maxOutputTokens,
    });
    let usage: ModelUsage | undefined;
    let finishReason: string | undefined;

    const record = async (
      status: "completed" | "provider_error" | "transport_error" | "invalid_output",
      errorCode?: string,
    ) => {
      await this.options.invocationSink?.({
        invocationId,
        provider: "bedrock-mantle",
        modelId: this.id,
        modelVersion: this.version,
        modelConfigurationFingerprint: this.configurationFingerprint,
        requestFingerprint,
        stage,
        attempt: metadata?.attempt ?? 1,
        maxOutputTokens,
        startedAt,
        completedAt: Date.now(),
        finishReason,
        status,
        errorCode,
        usage,
      });
    };

    await record("running");

    try {
      const response = await withProviderConcurrency(
        `bedrock-mantle:${this.options.region ?? "us-east-1"}`,
        this.options.providerConcurrencyLimit ??
          Number(process.env.RADAR_MODEL_PROVIDER_CONCURRENCY || "6"),
        async () =>
          this.request(
            `https://bedrock-mantle.${this.options.region ?? "us-east-1"}.api.aws/v1/chat/completions`,
            {
              method: "POST",
              signal: AbortSignal.timeout(timeoutMs),
              headers: {
                Authorization: `Bearer ${await this.apiKey()}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: this.version,
                stream: false,
                messages: [
                  { role: "system", content: instruction },
                  { role: "user", content: JSON.stringify(input) },
                ],
                max_tokens: maxOutputTokens,
                response_format: responseSchema
                  ? {
                      type: "json_schema",
                      json_schema: {
                        name: "radar_research",
                        strict: true,
                        schema: responseSchema,
                      },
                    }
                  : { type: "json_object" },
              }),
            },
          ),
      );

      if (!response.ok) {
        const transient = response.status === 429 || response.status >= 500;
        const retry = transient ? await providerRetryAfterMs(response) : undefined;
        if (!transient) clearTransientProviderBackoff(backoffKey);
        throw new ModelProviderUnavailableError(
          `Bedrock Mantle provider HTTP ${response.status}`,
          response.status,
          transient
            ? nextTransientProviderBackoff(backoffKey, retry, this.options.random)
            : retry,
        );
      }

      clearTransientProviderBackoff(backoffKey);
      const payload = (await response.json()) as {
        choices?: Array<{
          finish_reason?: string;
          message?: { content?: string | null; refusal?: string | null };
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
          prompt_tokens_details?: { cached_tokens?: number };
          completion_tokens_details?: { reasoning_tokens?: number };
        };
      };
      if (payload.usage) {
        this.lastUsage = {
          inputTokens: payload.usage.prompt_tokens,
          outputTokens: payload.usage.completion_tokens,
          totalTokens: payload.usage.total_tokens,
          cachedInputTokens: payload.usage.prompt_tokens_details?.cached_tokens,
          reasoningTokens: payload.usage.completion_tokens_details?.reasoning_tokens,
        };
        usage = {
          inputTokens: payload.usage.prompt_tokens,
          outputTokens: payload.usage.completion_tokens,
          totalTokens: payload.usage.total_tokens,
          cachedInputTokens: payload.usage.prompt_tokens_details?.cached_tokens,
          reasoningTokens: payload.usage.completion_tokens_details?.reasoning_tokens,
        };
      }
      const choice = payload.choices?.[0];
      finishReason = choice?.finish_reason;
      if (
        payload.choices?.length !== 1 ||
        choice?.finish_reason !== "stop" ||
        choice.message?.refusal ||
        typeof choice.message?.content !== "string" ||
        !choice.message.content.trim()
      ) {
        const error = new ModelInvalidOutputError(
          "Bedrock Mantle output incomplete or refused; no proposal accepted",
        );
        await record("invalid_output", error.message);
        throw error;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(choice.message.content);
      } catch {
        const error = new ModelInvalidOutputError(
          "Bedrock Mantle returned invalid JSON; no proposal accepted",
        );
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
      const credential =
        error instanceof Error && error.message.startsWith("BEDROCK_MANTLE_");
      await record(
        "transport_error",
        credential ? "BEDROCK_MANTLE_CREDENTIAL_UNAVAILABLE" : "BEDROCK_MANTLE_TRANSPORT_FAILURE",
      );
      if (credential) {
        clearTransientProviderBackoff(backoffKey);
        throw new ModelProviderUnavailableError(
          "Bedrock Mantle credential unavailable",
        );
      }
      throw new ModelProviderUnavailableError(
        "Bedrock Mantle transport failure",
        undefined,
        nextTransientProviderBackoff(backoffKey, undefined, this.options.random),
      );
    }
  }
}
