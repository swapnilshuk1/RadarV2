import { createServerFn } from "@tanstack/react-start";
import { getDatabaseAdapter } from "@/data/database";
import { AuthError, requireAuthUser } from "../auth/guard";
import { resolveServingScope } from "../security/scope-resolver";
import {
  EvaluationRuntimeControl,
  type EvaluationRuntimeState,
} from "./EvaluationRuntimeControl";

// Evaluation-stage GLM calls are hard-capped at 120s. Give telemetry 15s of
// grace for the terminal write, then treat a lingering `running` row as stale.
const EVALUATION_INVOCATION_STALE_MS = 135_000;

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
    /** Rows marked processing in durable storage, whether or not a worker is live. */
    processing: number;
    /** A fresh worker lease with a currently-running model invocation. */
    liveModelCalls: number;
    /** A fresh worker lease which has not begun a model invocation yet. */
    claimedWithoutModelCall: number;
    /** A processing row which can be reclaimed by a worker. */
    reclaimableProcessing: number;
    waitingEnrichment: number;
    completed: number;
    deadLetter: number;
  };
  latestCompletedAt: string | null;
  processingStateJobs: Array<{
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
    telemetryState: "live_model_call" | "claimed_without_model_call" | "reclaimable";
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

type CandidateScopeRequest = { tenantId?: string; personId?: string };
function requestedCandidateScope(data?: CandidateScopeRequest) {
  if (Boolean(data?.tenantId) !== Boolean(data?.personId)) throw new AuthError("CANDIDATE_SCOPE_INCOMPLETE", 400);
  return data;
}

async function resolveEvaluatorAccess(userId: string, db: ReturnType<typeof getDatabaseAdapter>, requested?: CandidateScopeRequest) {
  const scopeRequest = requestedCandidateScope(requested);
  const { scope, activeContext } = await resolveServingScope(userId, scopeRequest?.tenantId, db, scopeRequest?.personId);
  const membership = await db.one<{ role: string }>(
    `SELECT role
     FROM memberships
     WHERE user_id=? AND tenant_id=? AND status='active' AND revoked_at IS NULL`,
    [userId, scope.tenantId],
  );

  if (!membership) {
    throw new AuthError("FORBIDDEN: Active tenant membership required", 403);
  }

  // This controls a process-global daemon. Keep the operator boundary strict,
  // but source it from the active tenant membership rather than the profile
  // role cached in the browser session.
  return { scope, activeContext, canControl: membership.role === "admin" };
}

async function snapshotForUser(user: { id: string; role?: string }, requested?: CandidateScopeRequest): Promise<EvaluatorTelemetrySnapshot> {
  const db = getDatabaseAdapter();
  const { scope, activeContext, canControl } = await resolveEvaluatorAccess(user.id, db, requested);
  const runtime = await new EvaluationRuntimeControl(db).get(scope);
  const activeContextFingerprint = activeContext?.contextFingerprint ?? null;

  const telemetryNow = Date.now();
  const staleInvocationBefore = telemetryNow - EVALUATION_INVOCATION_STALE_MS;
  await db.execute(
    `UPDATE model_invocations
     SET status='transport_error',
         completed_at=?,
         latency_ms=?-started_at,
         error_code=COALESCE(error_code,'STALE_INVOCATION_RECONCILED')
     WHERE tenant_id=? AND person_id=? AND pipeline='evaluation'
       AND status='running' AND started_at<?`,
    [telemetryNow, telemetryNow, scope.tenantId, scope.personId, staleInvocationBefore],
  );

  const statusRows = await db.many<{ status: string; n: number }>(
    `SELECT ej.status AS status,COUNT(*) AS n
     FROM evaluation_jobs AS ej
     WHERE ej.tenant_id=? AND ej.person_id=?
       AND ej.evaluation_context_fingerprint=?
     GROUP BY ej.status`,
    [scope.tenantId, scope.personId, activeContextFingerprint],
  );
  const counts = Object.fromEntries(statusRows.map((row) => [row.status, Number(row.n)]));

  const latest = await db.one<{ completed_at: string | null }>(
    `SELECT MAX(ej.completed_at) AS completed_at
     FROM evaluation_jobs AS ej
     WHERE ej.tenant_id=? AND ej.person_id=? AND ej.status='staged_completed'
       AND ej.evaluation_context_fingerprint=?
`,
    [scope.tenantId, scope.personId, activeContextFingerprint],
  );

  const activeRows = await db.many<{
    id: string;
    canonical_job_id: string;
    attempts: number;
    max_attempts: number;
    first_claimed_at: string | null;
    locked_at: string | null;
    locked_by: string | null;
    reclaimable: number;
  }>(
    `SELECT id,canonical_job_id,attempts,max_attempts,first_claimed_at,locked_at,locked_by,
            CASE
              WHEN first_claimed_at IS NULL
                OR locked_at IS NULL
                OR locked_at < datetime('now', '-300 seconds')
              THEN 1 ELSE 0
            END AS reclaimable
     FROM evaluation_jobs AS ej
     WHERE tenant_id=? AND person_id=? AND status='staged_processing'
       AND evaluation_context_fingerprint=?
     ORDER BY COALESCE(first_claimed_at,created_at),created_at`,
    [scope.tenantId, scope.personId, activeContextFingerprint],
  );

  const processingStateJobs = await Promise.all(
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
           WHERE evaluation_job_id=? AND status='running'
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
      const hasLiveModelCall = Boolean(latestInvocation) && Number(job.reclaimable) === 0;
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
        telemetryState: (Number(job.reclaimable) === 1
          ? "reclaimable"
          : hasLiveModelCall
            ? "live_model_call"
            : "claimed_without_model_call") as "live_model_call" | "claimed_without_model_call" | "reclaimable",
      };
    }),
  );
  const liveModelCalls = processingStateJobs.filter((job) => job.telemetryState === "live_model_call").length;
  const claimedWithoutModelCall = processingStateJobs.filter(
    (job) => job.telemetryState === "claimed_without_model_call",
  ).length;
  const reclaimableProcessing = processingStateJobs.filter((job) => job.telemetryState === "reclaimable").length;

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
    `SELECT mi.id,mi.evaluation_job_id,mi.stage,mi.attempt,mi.status,mi.model_version,mi.started_at,mi.completed_at,
            mi.latency_ms,mi.input_tokens,mi.cached_input_tokens,mi.reasoning_tokens,mi.output_tokens,mi.total_tokens,mi.error_code
     FROM model_invocations AS mi
     JOIN evaluation_jobs AS ej ON ej.id=mi.evaluation_job_id
     WHERE mi.tenant_id=? AND mi.person_id=? AND mi.pipeline='evaluation'
       AND ej.evaluation_context_fingerprint=?
     ORDER BY mi.started_at DESC
     LIMIT 30`,
    [scope.tenantId, scope.personId, activeContextFingerprint],
  );

  return {
    control: {
      desiredState: runtime.desiredState,
      updatedAt: runtime.updatedAt,
      updatedBy: runtime.updatedBy,
      // A serving process never owns worker loops. Process supervision is
      // intentionally outside the request/runtime boundary.
      localDaemonRunning: false,
      canControl,
    },
    queue: {
      pending: Number(counts.staged_pending ?? 0),
      processing: Number(counts.staged_processing ?? 0),
      liveModelCalls,
      claimedWithoutModelCall,
      reclaimableProcessing,
      waitingEnrichment: Number(counts.staged_waiting_enrichment ?? 0),
      completed: Number(counts.staged_completed ?? 0),
      deadLetter: Number(counts.staged_dead_letter ?? 0),
    },
    latestCompletedAt: latest?.completed_at ?? null,
    processingStateJobs,
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
  .validator((data?: CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    return snapshotForUser(user, data);
  });

export const controlEvaluatorFn = createServerFn({ method: "POST" })
  .validator((data: { action: "start" | "pause" | "resume" | "stop" } & CandidateScopeRequest) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const db = getDatabaseAdapter();
    const { canControl } = await resolveEvaluatorAccess(user.id, db, data);
    if (!canControl) {
      throw new AuthError("FORBIDDEN: Active tenant administrator privileges required", 403);
    }
    const control = new EvaluationRuntimeControl(db);

    const access = await resolveEvaluatorAccess(user.id, db, data);
    if (data.action === "pause") {
      await control.set(access.scope, "PAUSED", user.id);
    } else if (data.action === "stop") {
      await control.set(access.scope, "STOPPED", user.id);
    } else {
      if (!access.activeContext) throw new AuthError("NO_ACTIVE_EVALUATION_CONTEXT", 409);
      await control.set(access.scope, "RUNNING", user.id);
      // The supervised evaluation daemon owns queue claims. The request must
      // return immediately instead of executing a model call inside HTTP.
    }

    return snapshotForUser(user, data);
  });
