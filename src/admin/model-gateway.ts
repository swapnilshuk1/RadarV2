import type { DatabaseAdapter } from "../data/database/adapter";
import type { ReasoningModel } from "../dossier/contracts";
import type { ModelInvocationContext, ModelInvocationSink } from "../lib/model/model-invocation";
import { BedrockMantleJsonModel } from "../lib/model/bedrock-mantle-model";
import { loadMantleCredentials } from "../lib/model/bedrock-credentials";
import { GLM_STAGE_OUTPUT_TOKENS } from "../lib/model/bedrock-glm-research-model";
import { jobConfig } from "./config-store";
import type { EngineConfig, ModelLane } from "./config-contracts";
import {
  acquireProviderCapacity,
  renewProviderCapacity,
  releaseProviderCapacity,
  operationalSettings,
  observeProviderFailure,
  assertProviderDispatch,
  providerSucceeded,
} from "./operations-runtime";
import { ModelProviderUnavailableError } from "../lib/model/provider-unavailable";
import { getDatabaseTargetIdentity } from "../data/database";
import { recordModelRuntimeReceipt } from "./search-connections";
import type { WorkIdentity } from "./operations-contracts";

export function operationalModel(
  db: DatabaseAdapter,
  model: ReasoningModel,
  context: ModelInvocationContext,
  configRevision?: string,
  effectiveSettings?: Record<string, unknown>,
): ReasoningModel {
  const connectionId = model.id.includes("gemini") ? "google:host" : "bedrock:host";
  const jobId =
    context.evaluationJobId ??
    context.dossierCompositionJobId ??
    context.reviewJobId ??
    context.pursuitPreparationJobId;
  const work: WorkIdentity | undefined = jobId
    ? {
        pipeline: context.pipeline,
        jobId,
        tenantId: context.tenantId,
        personId: context.personId,
        canonicalJobId: context.canonicalJobId,
        opportunityVersion: context.opportunityVersion,
        contextFingerprint: context.evaluationContextFingerprint,
      }
    : undefined;
  return new Proxy(model, {
    get(target, key) {
      if (key !== "generate") {
        const value = Reflect.get(target, key);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: Parameters<ReasoningModel["generate"]>) => {
        if (configRevision)
          await recordModelRuntimeReceipt(db, connectionId, configRevision, {
            modelId: model.id,
            modelVersion: model.version,
            ...effectiveSettings,
          });
        await assertProviderDispatch(db, connectionId, work);
        const owner = `model:${process.pid}:${jobId}`;
        const settings = await operationalSettings(db);
        const capacity = await acquireProviderCapacity(
          db,
          connectionId,
          owner,
          settings.settings.profile === "Recovery" ? 1 : settings.settings.providerConcurrency,
        );
        // Adapters can make several bounded attempts; renew while the call lives.
        // A dead process stops renewing, and a stale owner cannot accept its output.
        let leaseLost = false,
          renewing = false;
        const timer = setInterval(() => {
          if (renewing) return;
          renewing = true;
          void renewProviderCapacity(db, capacity, owner)
            .then(
              (ok) => {
                if (!ok) leaseLost = true;
              },
              () => {
                leaseLost = true;
              },
            )
            .finally(() => {
              renewing = false;
            });
        }, 30000);
        timer.unref();
        try {
          const result = await target.generate(...args);
          if (leaseLost || !(await renewProviderCapacity(db, capacity, owner)))
            throw new ModelProviderUnavailableError(
              "PROVIDER_CAPACITY_LEASE_LOST",
              undefined,
              2000,
            );
          await providerSucceeded(db, connectionId, 0);
          return result;
        } catch (error) {
          if (
            error instanceof ModelProviderUnavailableError &&
            error.message !== "PROVIDER_CAPACITY_LEASE_LOST"
          )
            await observeProviderFailure(db, {
              connectionId,
              provider: model.id,
              generation: 0,
              failure:
                error.httpStatus === 401 || error.httpStatus === 403
                  ? "credential"
                  : error.httpStatus === 429
                    ? "throttled"
                    : error.httpStatus && error.httpStatus >= 500
                      ? "provider_outage"
                      : "transport",
              status: error.httpStatus,
              retryAfterMs: error.retryAfterMs,
              deployment: getDatabaseTargetIdentity().fingerprint,
              work,
            });
          throw error;
        } finally {
          clearInterval(timer);
          await releaseProviderCapacity(db, capacity, owner);
        }
      };
    },
  });
}
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
      if (!key)
        throw new ModelProviderUnavailableError("BEDROCK_MANTLE_CREDENTIAL_UNAVAILABLE", 401);
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
  return operationalModel(
    db,
    laneModel(
      pinned.config,
      context.pipeline === "evaluation" ? "reasoning" : "writing",
      legacy,
      sink,
      context.tenantId,
    ),
    context,
    pinned.id,
    pinned.config[context.pipeline === "evaluation" ? "reasoning" : "writing"].model === "legacy"
      ? { limitsSource: "host; numeric adapter limits are not administratively managed" }
      : {
          limitsSource: "admin",
          ...pinned.config[context.pipeline === "evaluation" ? "reasoning" : "writing"],
        },
  );
}
