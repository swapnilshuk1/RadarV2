import { createHash, randomUUID } from "node:crypto";
import type { DatabaseAdapter } from "@/data/database";

export type ModelPipeline = "evaluation" | "dossier" | "factual_review";

export interface ModelCallMetadata {
  stage?: string;
  attempt?: number;
  maxOutputTokens?: number;
}

export interface ModelInvocationContext {
  pipeline: ModelPipeline;
  tenantId: string;
  personId: string;
  canonicalJobId: string;
  opportunityVersion: string;
  evaluationContextFingerprint: string;
  evaluationJobId?: string;
  dossierCompositionJobId?: string;
  reviewJobId?: string;
}

export interface ModelUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  totalTokens?: number;
}

export interface ModelInvocationEvent {
  invocationId: string;
  provider: string;
  modelId: string;
  modelVersion: string;
  modelConfigurationFingerprint: string;
  requestFingerprint: string;
  stage: string;
  attempt: number;
  maxOutputTokens?: number;
  startedAt: number;
  completedAt?: number;
  finishReason?: string;
  status: "running" | "completed" | "provider_error" | "transport_error" | "invalid_output";
  errorCode?: string;
  usage?: ModelUsage;
}

export type ModelInvocationSink = (event: ModelInvocationEvent) => Promise<void>;

export function modelRequestFingerprint(
  instruction: string,
  input: unknown,
  responseSchema: Record<string, unknown> | undefined,
  metadata: ModelCallMetadata | undefined,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        instruction,
        input,
        responseSchema ?? null,
        metadata?.stage ?? "unspecified",
        metadata?.attempt ?? 1,
        metadata?.maxOutputTokens ?? null,
      ]),
    )
    .digest("hex");
}

export function createSqliteModelInvocationSink(
  db: DatabaseAdapter,
  context: ModelInvocationContext,
): ModelInvocationSink {
  return async (event) => {
    try {
      const completedAt = event.completedAt ?? null;
      const latencyMs =
        event.completedAt === undefined
          ? null
          : Math.max(0, event.completedAt - event.startedAt);

      await db.execute(
        `INSERT INTO model_invocations(
          id,evaluation_job_id,dossier_composition_job_id,review_job_id,
          tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,
          pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,
          request_fingerprint,max_output_tokens,started_at,completed_at,latency_ms,
          input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,
          finish_reason,status,error_code
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(id) DO UPDATE SET
          completed_at=excluded.completed_at,
          latency_ms=excluded.latency_ms,
          input_tokens=excluded.input_tokens,
          cached_input_tokens=excluded.cached_input_tokens,
          output_tokens=excluded.output_tokens,
          reasoning_tokens=excluded.reasoning_tokens,
          total_tokens=excluded.total_tokens,
          finish_reason=excluded.finish_reason,
          status=excluded.status,
          error_code=excluded.error_code`,
        [
          event.invocationId,
          context.evaluationJobId ?? null,
          context.dossierCompositionJobId ?? null,
          context.reviewJobId ?? null,
          context.tenantId,
          context.personId,
          context.canonicalJobId,
          context.opportunityVersion,
          context.evaluationContextFingerprint,
          context.pipeline,
          event.stage,
          event.attempt,
          event.provider,
          event.modelId,
          event.modelVersion,
          event.modelConfigurationFingerprint,
          event.requestFingerprint,
          event.maxOutputTokens ?? null,
          event.startedAt,
          completedAt,
          latencyMs,
          event.usage?.inputTokens ?? null,
          event.usage?.cachedInputTokens ?? null,
          event.usage?.outputTokens ?? null,
          event.usage?.reasoningTokens ?? null,
          event.usage?.totalTokens ?? null,
          event.finishReason ?? null,
          event.status,
          event.errorCode ?? null,
        ],
      );

      const jobId =
        context.evaluationJobId ??
        context.dossierCompositionJobId ??
        context.reviewJobId ??
        "unscoped";
      if (event.status === "running") {
        console.log(
          `[MODEL_START] pipeline=${context.pipeline} job=${jobId} stage=${event.stage} attempt=${event.attempt} model=${event.modelVersion}`,
        );
      } else {
        console.log(
          `[MODEL_END] pipeline=${context.pipeline} job=${jobId} stage=${event.stage} status=${event.status} latency_ms=${latencyMs ?? 0} total_tokens=${event.usage?.totalTokens ?? "unknown"}`,
        );
      }
    } catch (error) {
      // Never repeat an expensive provider request because observability storage
      // failed before or after the provider call.
      console.warn(
        "[ModelInvocation] Durable telemetry write failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  };
}

class AsyncSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];
  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
    this.active += 1;
    try {
      return await fn();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

const globalLimiters = globalThis as typeof globalThis & {
  __RADAR_MODEL_PROVIDER_LIMITERS__?: Map<string, AsyncSemaphore>;
};

export function withProviderConcurrency<T>(
  providerKey: string,
  limit: number,
  fn: () => Promise<T>,
): Promise<T> {
  const bounded = Math.max(1, Math.floor(limit));
  const map =
    globalLimiters.__RADAR_MODEL_PROVIDER_LIMITERS__ ??
    (globalLimiters.__RADAR_MODEL_PROVIDER_LIMITERS__ = new Map());
  const key = `${providerKey}:${bounded}`;
  let semaphore = map.get(key);
  if (!semaphore) {
    semaphore = new AsyncSemaphore(bounded);
    map.set(key, semaphore);
  }
  return semaphore.run(fn);
}
