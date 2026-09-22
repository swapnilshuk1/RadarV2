import { geminiContextCacheRequest } from "./gemini-context-cache";
import { adcTokenProvider } from "./google-adc";
import { GeminiJsonModel } from "./json-model";
import { ModelProviderUnavailableError } from "./provider-unavailable";
import type { ModelInvocationSink } from "./model-invocation";

/** Explicit independent dossier reviewer; never substitutes for the staged evaluator. */
export function createGeminiFactualReviewModel(
  options: {
    projectId?: string;
    token?: () => Promise<string>;
    request?: typeof fetch;
    contextCache?: boolean;
    model?: string;
    invocationSink?: ModelInvocationSink;
    providerConcurrencyLimit?: number;
  } = {},
) {
  const projectId = (options.projectId ?? process.env.GCP_PROJECT_ID)?.trim();
  if (!projectId) throw new ModelProviderUnavailableError("GEMINI_REVIEW_PROJECT_UNCONFIGURED");
  const model = new GeminiJsonModel(
    projectId,
    options.token ?? adcTokenProvider(),
    (options.contextCache ?? process.env.RADAR_GEMINI_CONTEXT_CACHE !== "off")
      ? geminiContextCacheRequest(options.request ?? fetch)
      : (options.request ?? fetch),
    {
      model: options.model ?? process.env.RADAR_FACTUAL_REVIEW_MODEL ?? "gemini-3.8-flash",
      location: "global",
      schemaFormat: "json-schema",
      thinkingLevel: "MEDIUM",
      // The provider counts thinking inside this ceiling. Leave room for both
      // medium reasoning and the required per-passage structured assessment.
      maxOutputTokens: 16384,
      timeoutMs: 120000,
      invocationSink: options.invocationSink,
      providerConcurrencyLimit: options.providerConcurrencyLimit,
    },
  );
  const generate = model.generate.bind(model);
  model.generate = async (instruction, input, schema, metadata) => {
    try {
      return await generate(instruction, input, schema, metadata);
    } catch (error) {
      // Infrastructure failures must pause durable work, not consume semantic repair attempts.
      if (
        error instanceof SyntaxError ||
        (error instanceof Error && error.message.startsWith("Model output incomplete:"))
      )
        throw new ModelProviderUnavailableError(
          `GEMINI_REVIEW_OUTPUT_INCOMPLETE: ${error instanceof SyntaxError ? "invalid JSON" : error.message.replace("Model output incomplete: ", "")}; no factual assessment was accepted`,
          undefined,
          30_000,
        );
      const httpStatus =
        error instanceof ModelProviderUnavailableError
          ? error.httpStatus
          : error instanceof Error
            ? Number(error.message.match(/HTTP (\d{3})/)?.[1]) || undefined
            : undefined;
      const reason =
        error instanceof Error && /ADC|credential/i.test(error.message)
          ? "AUTH"
          : error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)
            ? "TIMEOUT"
            : error instanceof Error && error.message === "fetch failed"
              ? "NETWORK"
              : "REQUEST";
      throw new ModelProviderUnavailableError(
        `GEMINI_REVIEW_PROVIDER_UNAVAILABLE: ${reason}${httpStatus ? ` (HTTP ${httpStatus})` : ""}; verify ADC, project, model access and quota`,
        httpStatus,
        error instanceof ModelProviderUnavailableError
          ? error.retryAfterMs
          : ["TIMEOUT", "NETWORK"].includes(reason)
            ? 30_000
            : undefined,
      );
    }
  };
  return model;
}