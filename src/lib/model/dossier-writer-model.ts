import type { ReasoningModel } from "@/dossier/contracts";
import { createBedrockGlmResearchModel } from "./bedrock-glm-research-model";
import { adcTokenProvider } from "./google-adc";
import { GeminiJsonModel } from "./json-model";
import {
  ModelInvalidOutputError,
  ModelProviderUnavailableError,
} from "./provider-unavailable";
import type { ModelInvocationSink } from "./model-invocation";

export function createDossierWriterModel(
  options: {
    invocationSink?: ModelInvocationSink;
    providerConcurrencyLimit?: number;
  } = {},
): ReasoningModel {
  const provider = (process.env.RADAR_DOSSIER_WRITER_PROVIDER ?? "glm").trim().toLowerCase();

  if (provider === "glm") {
    return createBedrockGlmResearchModel(options);
  }

  if (provider !== "gemini") {
    throw new Error(`Unsupported dossier writer provider: ${provider}`);
  }

  const projectId = process.env.GCP_PROJECT_ID?.trim();
  if (!projectId) {
    throw new ModelProviderUnavailableError("GEMINI_DOSSIER_PROJECT_UNCONFIGURED");
  }

  const model = new GeminiJsonModel(
    projectId,
    adcTokenProvider(),
    fetch,
    {
      model:
        process.env.RADAR_DOSSIER_WRITER_MODEL?.trim() ||
        process.env.RADAR_FACTUAL_REVIEW_MODEL?.trim() ||
        "gemini-3.8-flash",
      location: "global",
      schemaFormat: "json-schema",
      thinkingLevel: "LOW",
      maxOutputTokens: 12_288,
      timeoutMs: 120_000,
      invocationSink: options.invocationSink,
      providerConcurrencyLimit: options.providerConcurrencyLimit,
    },
  );

  const generate = model.generate.bind(model);
  model.generate = async (instruction, input, schema, metadata) => {
    try {
      return await generate(instruction, input, schema, metadata);
    } catch (error) {
      if (
        error instanceof ModelInvalidOutputError ||
        error instanceof ModelProviderUnavailableError
      ) {
        throw error;
      }
      const transient =
        error instanceof Error &&
        (["TimeoutError", "AbortError"].includes(error.name) ||
          /timeout|fetch|network|transport/i.test(error.message));
      if (transient) {
        throw new ModelProviderUnavailableError(
          "GEMINI_DOSSIER_PROVIDER_UNAVAILABLE",
          undefined,
          30_000,
        );
      }
      throw error;
    }
  };

  return model;
}
