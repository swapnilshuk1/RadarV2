import { createServerFn } from "@tanstack/react-start";
import { getDatabaseAdapter } from "@/data/database";
import { requireAuthUser } from "../auth/guard";
import { resolveServingScope } from "../security/scope-resolver";
import {
  EvaluationRuntimeControl,
  type EvaluationRuntimeState,
} from "./EvaluationRuntimeControl";

export interface EvaluatorTelemetrySnapshot {
  control: {
    desiredState: EvaluationRuntimeState;
    updatedAt: number;
    updatedBy: string | null;
    localDaemonRunning: boolean;
    canControl: boolean;
  };
  queue: {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    deadLetter: number;
  };
  latestCompletedAt: string | null;
  activeJobs: Array<{
    id: string;
    canonicalJobId: string;
    attempts: number;
    maxAttempts: number;
    firstClaimedAt: string | null;
    lockedAt: string | null;
    workerId: string | null;
    currentStage: string | null;
    invocationStatus: string | null;
    invocationStartedAt: number | null;
    modelVersion: string | null;
    invocationAttempt: number | null;
    totalTokens: number;
  }>;
  recentInvocations: Array<{
    id: string;
    evaluationJobId: string | null;
    stage: string;
    attempt: number;
    status: string;
    modelVersion: string;
    startedAt: number;
    completedAt: number | null;
    latencyMs: number | null;
    inputTokens: number | null;
    cachedInputTokens: number | null;
    reasoningTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    errorCode: string | null;
  }>;
}

async function snapshotForUser(user: { id: string; role?: string }): Promise<EvaluatorTelemetrySnapshot> {
  const db = getDatabaseAdapter();
  const { scope } = await resolveServingScope(user.id, undefined, db);
  const runtime = await new EvaluationRuntimeControl(db).get();
  const { EvaluationDaemon } = await import("./EvaluationDaemon");
  const local = EvaluationDaemon.getGlobalDaemonRuntimeStatus();

  const statusRows = await db.many<{ status: string; n: number }>(
    `SELECT status,COUNT(*) AS n
     FROM evaluation_jobs
     WHERE tenant_id=? AND person_id=?
     GROUP BY status`,
    [scope.tenantId, scope.personId],
  );
  const counts = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.n)]));

  const latest = await db.one<{ completed_at: string | null }>(
    `SELECT MAX(completed_at) AS completed_at
     FROM evaluation_jobs
     WHERE tenant_id=? AND person_id=? AND status='completed'`,
    [scope.tenantId, scope.personId],
  );

  const activeRows = await db.many<{
    id: string;
    canonical_job_id: string;
    attempts: number;
    max_attempts: number;
    first_claimed_at: string | null;
    locked_at: string | null;
    locked_by: string | null;
  }>(
    `SELECT id,canonical_job_id,attempts,max_attempts,first_claimed_at,locked_at,locked_by
     FROM evaluation_jobs
     WHERE tenant_id=? AND person_id=? AND status IN ('processing','staged_processing')
     ORDER BY COALESCE(first_claimed_at,created_at),created_at`,
    [scope.tenantId, scope.personId],
  );

  const activeJobs = await Promise.all(
    activeRows.map(async (job) => {
      const [latestInvocation, tokenRow] = await Promise.all([
        db.one<{
          stage: string;
          status: string;
          started_at: number;
          model_version: string;
          attempt: number;
        }>(
          `SELECT stage,status,started_at,model_version,attempt
           FROM model_invocations
           WHERE evaluation_job_id=?
           ORDER BY started_at DESC
           LIMIT 1`,
          [job.id],
        ),
        db.one<{ total_tokens: number | null }>(
          `SELECT COALESCE(SUM(total_tokens),0) AS total_tokens
           FROM model_invocations
           WHERE evaluation_job_id=?`,
          [job.id],
        ),
      ]);
      return {
        id: job.id,
        canonicalJobId: job.canonical_job_id,
        attempts: Number(job.attempts),
        maxAttempts: Number(job.max_attempts),
        firstClaimedAt: job.first_claimed_at,
        lockedAt: job.locked_at,
        workerId: job.locked_by,
        currentStage: latestInvocation?.stage ?? null,
        invocationStatus: latestInvocation?.status ?? null,
        invocationStartedAt: latestInvocation ? Number(latestInvocation.started_at) : null,
        modelVersion: latestInvocation?.model_version ?? null,
        invocationAttempt: latestInvocation ? Number(latestInvocation.attempt) : null,
        totalTokens: Number(tokenRow?.total_tokens ?? 0),
      };
    }),
  );

  const recentRows = await db.many<{
    id: string;
    evaluation_job_id: string | null;
    stage: string;
    attempt: number;
    status: string;
    model_version: string;
    started_at: number;
    completed_at: number | null;
    latency_ms: number | null;
    input_tokens: number | null;
    cached_input_tokens: number | null;
    reasoning_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
    error_code: string | null;
  }>(
    `SELECT id,evaluation_job_id,stage,attempt,status,model_version,started_at,completed_at,
            latency_ms,input_tokens,cached_input_tokens,reasoning_tokens,output_tokens,total_tokens,error_code
     FROM model_invocations
     WHERE tenant_id=? AND person_id=? AND pipeline='evaluation'
     ORDER BY started_at DESC
     LIMIT 30`,
    [scope.tenantId, scope.personId],
  );

  return {
    control: {
      desiredState: runtime.desiredState,
      updatedAt: runtime.updatedAt,
      updatedBy: runtime.updatedBy,
      localDaemonRunning: local.running,
      canControl: user.role === "admin",
    },
    queue: {
      pending: Number(counts.staged_pending ?? 0) + Number(counts.pending ?? 0),
      processing: Number(counts.staged_processing ?? 0) + Number(counts.processing ?? 0),
      completed: Number(counts.completed ?? 0),
      failed: Number(counts.failed ?? 0),
      deadLetter: Number(counts.dead_letter ?? 0),
    },
    latestCompletedAt: latest?.completed_at ?? null,
    activeJobs,
    recentInvocations: recentRows.map((row) => ({
      id: row.id,
      evaluationJobId: row.evaluation_job_id,
      stage: row.stage,
      attempt: Number(row.attempt),
      status: row.status,
      modelVersion: row.model_version,
      startedAt: Number(row.started_at),
      completedAt: row.completed_at === null ? null : Number(row.completed_at),
      latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
      inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
      cachedInputTokens: row.cached_input_tokens === null ? null : Number(row.cached_input_tokens),
      reasoningTokens: row.reasoning_tokens === null ? null : Number(row.reasoning_tokens),
      outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
      totalTokens: row.total_tokens === null ? null : Number(row.total_tokens),
      errorCode: row.error_code,
    })),
  };
}

export const getEvaluatorTelemetryFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireAuthUser();
    return snapshotForUser(user);
  });

export const controlEvaluatorFn = createServerFn({ method: "POST" })
  .validator((data: { action: "start" | "pause" | "resume" | "stop" }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser({ requireAdmin: true });
    const db = getDatabaseAdapter();
    const control = new EvaluationRuntimeControl(db);

    if (data.action === "pause") {
      await control.set("PAUSED", user.id);
    } else if (data.action === "stop") {
      await control.set("STOPPED", user.id);
      const { EvaluationDaemon } = await import("./EvaluationDaemon");
      EvaluationDaemon.stopGlobalDaemon();
    } else {
      await control.set("RUNNING", user.id);
      const { EvaluationDaemon } = await import("./EvaluationDaemon");
      EvaluationDaemon.startGlobalDaemon(2000);
    }

    return snapshotForUser(user);
  });
