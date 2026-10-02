import type { DatabaseAdapter } from "../data/database/adapter";
import type { ReasoningModel } from "../dossier/contracts";
import type { ModelInvocationContext, ModelInvocationSink } from "../lib/model/model-invocation";
import { BedrockMantleJsonModel } from "../lib/model/bedrock-mantle-model";
import { loadMantleCredentials } from "../lib/model/bedrock-credentials";
import { GLM_STAGE_OUTPUT_TOKENS } from "../lib/model/bedrock-glm-research-model";
import { jobConfig } from "./config-store";
import type { EngineConfig, ModelLane } from "./config-contracts";
export function laneModel(
  config: EngineConfig,
  lane: ModelLane,
  legacy: () => ReasoningModel,
  sink?: ModelInvocationSink,
  concurrencyScope = "platform",
): ReasoningModel {
  const settings = config[lane];
  if (settings.model === "legacy") return legacy();
  const model = new BedrockMantleJsonModel(
    settings.model,
    async () => {
      loadMantleCredentials();
      const key = process.env.BEDROCK_MANTLE_API_KEY?.trim();
      if (!key) throw new Error("BEDROCK_MANTLE_CREDENTIAL_UNAVAILABLE");
      return key;
    },
    fetch,
    {
      region: "us-east-1",
      timeoutMs: settings.timeoutMs,
      maxOutputTokens: settings.maxOutputTokens,
      stageOutputTokens: Object.fromEntries(
        Object.entries(GLM_STAGE_OUTPUT_TOKENS).map(([stage, max]) => [
          stage,
          Math.min(max, settings.maxOutputTokens),
        ]),
      ),
      invocationSink: sink,
      providerConcurrencyLimit: settings.concurrency,
      providerConcurrencyKey: `radar-lane:${concurrencyScope}:${lane}`,
    },
  );
  const generate = model.generate.bind(model);
  model.generate = (instruction, input, schema, metadata) =>
    generate(instruction, input, schema, {
      ...metadata,
      maxOutputTokens: Math.min(
        metadata?.maxOutputTokens ??
          GLM_STAGE_OUTPUT_TOKENS[metadata?.stage as keyof typeof GLM_STAGE_OUTPUT_TOKENS] ??
          settings.maxOutputTokens,
        settings.maxOutputTokens,
      ),
    });
  return model;
}
export async function createJobModel(
  db: DatabaseAdapter,
  context: ModelInvocationContext,
  legacy: () => ReasoningModel,
  sink?: ModelInvocationSink,
) {
  const id =
    context.evaluationJobId ??
    context.dossierCompositionJobId ??
    context.reviewJobId ??
    context.pursuitPreparationJobId;
  if (!id) throw new Error("CONFIG_MODEL_JOB_UNSCOPED");
  const pinned = await jobConfig(db, context.pipeline, id);
  return laneModel(
    pinned.config,
    context.pipeline === "evaluation" ? "reasoning" : "writing",
    legacy,
    sink,
    context.tenantId,
  );
}
