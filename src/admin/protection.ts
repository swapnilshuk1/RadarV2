import { createHash } from "node:crypto";
import type { DatabaseAdapter } from "../data/database/adapter";
import type { ModelInvocationContext, ModelInvocationEvent } from "../lib/model/model-invocation";
import { ModelProviderUnavailableError } from "../lib/model/provider-unavailable";

import {
  quotaDimensions,
  type ProtectedPipeline,
  type QuotaDimension,
  type TenantQuota,
} from "./protection-contracts";
export {
  pipelines,
  quotaDimensions,
  validateQuota,
  type ProtectedPipeline,
  type QuotaDimension,
  type TenantQuota,
} from "./protection-contracts";
export class QuotaDeferredError extends ModelProviderUnavailableError {
  constructor(readonly reason: string) {
    super(`QUOTA_DEFERRED: ${reason}`, 429, 300_000);
    this.name = "QuotaDeferredError";
  }
}
export async function protectionInstalled(db: DatabaseAdapter) {
  return Boolean(
    await db.one("SELECT name FROM sqlite_master WHERE type='table' AND name='tenant_quotas'"),
  );
}
export async function deferralFilter(
  db: DatabaseAdapter,
  pipeline: ProtectedPipeline,
  jobExpression: string,
) {
  if (!/^[a-z_]+(?:\.[a-z_]+)?$/.test(jobExpression)) throw new Error("INVALID_JOB_EXPRESSION");
  if (!(await protectionInstalled(db))) return "";
  return ` AND NOT EXISTS(SELECT 1 FROM quota_deferrals qd WHERE qd.pipeline='${pipeline}' AND qd.job_id=${jobExpression} AND qd.retry_at>${Date.now()}) `;
}
export async function releaseReservation(
  db: DatabaseAdapter,
  pipeline: ProtectedPipeline,
  jobId: string,
  token: string,
) {
  if (!(await protectionInstalled(db))) return;
  const table = {
    evaluation: "evaluation_jobs",
    dossier: "dossier_composition_jobs",
    factual_review: "dossier_review_jobs",
    pursuit: "pursuit_preparation_jobs",
    scrape: "scrape_runs",
  }[pipeline];
  const row = await db.one<{ status: string }>(`SELECT status FROM ${table} WHERE id=?`, [jobId]);
  await finishReservation(
    db,
    pipeline,
    jobId,
    token,
    Boolean(
      row &&
      [
        "completed",
        "failed",
        "aborted",
        "needs_attention",
        "staged_completed",
        "staged_dead_letter",
      ].includes(row.status),
    ),
  );
}
async function policy(db: DatabaseAdapter, tenant: string, now: number) {
  const row = await db.one<TenantQuota>("SELECT * FROM tenant_quotas WHERE tenant_id=?", [tenant]);
  if (!row) return null;
  const overrides = await db.many<{ dimension: QuotaDimension; limit_value: number }>(
    "SELECT dimension,limit_value FROM tenant_quota_overrides WHERE tenant_id=? AND expires_at>?",
    [tenant, now],
  );
  for (const override of overrides)
    if (quotaDimensions.includes(override.dimension))
      row[override.dimension] = override.limit_value;
  return row;
}
async function monthlyReserved(
  db: DatabaseAdapter,
  tenant: string,
  lane: string,
  month: string,
  exclude?: { pipeline: string; id: string },
) {
  const spent = await db.one<{ n: number }>(
    `SELECT COALESCE(SUM(c.input_charged+c.output_charged),0) n FROM quota_calls c
 JOIN quota_jobs j ON j.pipeline=c.pipeline AND j.job_id=c.job_id WHERE c.tenant_id=? AND c.month=? AND j.lane=?`,
    [tenant, month, lane],
  );
  const held = await db.one<{ n: number }>(
    `SELECT COALESCE(SUM(MAX(0,input_limit-input_used)+MAX(0,output_limit-output_used)),0) n
 FROM quota_jobs WHERE tenant_id=? AND month=? AND lane=? AND closed=0 ${exclude ? "AND NOT(pipeline=? AND job_id=?)" : ""}`,
    [tenant, month, lane, ...(exclude ? [exclude.pipeline, exclude.id] : [])],
  );
  // Legacy invocations are not in quota_calls. Unknown usage cannot become free capacity.
  const start = Date.parse(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  const legacy = await db.one<{ n: number; unknown: number }>(
    `SELECT
    COALESCE(SUM(MAX(COALESCE(total_tokens,0), COALESCE(input_tokens,0)+COALESCE(output_tokens,0)+CASE WHEN provider='vertex-gemini' THEN COALESCE(reasoning_tokens,0) ELSE 0 END)),0) n,
    COALESCE(SUM(input_tokens IS NULL OR output_tokens IS NULL),0) unknown
    FROM model_invocations m WHERE tenant_id=? AND started_at>=? AND started_at<?
    AND ${lane === "reasoning" ? "pipeline='evaluation'" : "pipeline IN ('dossier','factual_review','pursuit')"}
    AND NOT EXISTS(SELECT 1 FROM quota_calls c WHERE c.id=m.id)`,
    [tenant, start, end.getTime()],
  );
  if (legacy?.unknown) return Infinity;
  return (spent?.n ?? 0) + (held?.n ?? 0) + (legacy?.n ?? 0);
}
export async function alert(
  db: DatabaseAdapter,
  tenant: string,
  kind: string,
  target: string,
  message: string,
  now = Date.now(),
) {
  const id = createHash("sha256")
    .update(JSON.stringify([tenant, kind, target]))
    .digest("hex");
  await db.execute(
    `INSERT INTO admin_alerts VALUES(?,?,?,?,?,?,?,NULL,NULL)
 ON CONFLICT(id) DO UPDATE SET message=excluded.message,last_seen=excluded.last_seen`,
    [id, tenant, kind, target, message, now, now],
  );
}
export async function deferClaim(
  db: DatabaseAdapter,
  pipeline: ProtectedPipeline,
  jobId: string,
  tenant: string,
  reason: string,
  now = Date.now(),
) {
  const prior = await db.one<{ reason: string }>(
    "SELECT reason FROM quota_deferrals WHERE tenant_id=? AND pipeline=? AND job_id=?",
    [tenant, pipeline, jobId],
  );
  await db.execute(
    `INSERT INTO quota_deferrals VALUES(?,?,?,?,?,?) ON CONFLICT(pipeline,job_id)
 DO UPDATE SET reason=excluded.reason,retry_at=excluded.retry_at,updated_at=excluded.updated_at`,
    [pipeline, jobId, tenant, reason, now + 300_000, now],
  );
  await alert(db, tenant, "QUOTA_DEFERRED", `${pipeline}:${jobId}`, reason, now);
  if (!prior || prior.reason !== reason)
    await db.execute(
      "UPDATE admin_alerts SET acknowledged_at=NULL,acknowledged_by=NULL WHERE tenant_id=? AND kind='QUOTA_DEFERRED' AND target=?",
      [tenant, `${pipeline}:${jobId}`],
    );
  return false;
}

/** Caller must hold the same transaction as the queue's fenced claim mutation. */
export async function reserveClaim(
  db: DatabaseAdapter,
  job: {
    pipeline: ProtectedPipeline;
    id: string;
    tenant: string;
    token: string;
    leaseUntil: number;
  },
  now = Date.now(),
) {
  if (!(await protectionInstalled(db))) return true; // Older schemas are explicitly unconfigured.
  const controls = await db.one(
    `SELECT scope_key FROM pipeline_controls WHERE paused=1
 AND scope_key IN ('*',?) AND pipeline IN ('*',?) LIMIT 1`,
    [job.tenant, job.pipeline],
  );
  if (controls) return deferClaim(db, job.pipeline, job.id, job.tenant, "PAUSED", now);
  const limits = await policy(db, job.tenant, now);
  if (!limits) return true;
  // Recover a completion committed before a worker crashed during cleanup.
  // Only terminal canonical queue state releases the unused reservation.
  for (const [pipeline, table] of Object.entries({
    evaluation: "evaluation_jobs",
    dossier: "dossier_composition_jobs",
    factual_review: "dossier_review_jobs",
    pursuit: "pursuit_preparation_jobs",
    scrape: "scrape_runs",
  })) {
    await db.execute(
      `UPDATE quota_jobs SET closed=1,lease_until=0 WHERE tenant_id=? AND pipeline=? AND closed=0
      AND EXISTS(SELECT 1 FROM ${table} j WHERE j.id=quota_jobs.job_id AND j.tenant_id=quota_jobs.tenant_id
      AND j.status IN ('completed','failed','aborted','cancelled','needs_attention','staged_completed','staged_dead_letter'))`,
      [job.tenant, pipeline],
    );
  }

  const day = new Date(now).toISOString().slice(0, 10),
    month = day.slice(0, 7);
  const lane = job.pipeline === "evaluation" ? "reasoning" : "writing";
  const existing = await db.one<{
    input_used: number;
    output_used: number;
    input_limit: number;
    output_limit: number;
    closed: number;
    invalid_reviewed_at: number;
    tenant_id: string;
  }>("SELECT * FROM quota_jobs WHERE pipeline=? AND job_id=?", [job.pipeline, job.id]);
  if (existing && existing.tenant_id !== job.tenant) throw new Error("QUOTA_JOB_SCOPE_MISMATCH");
  const deferred = await db.one<{ reason: string }>(
    "SELECT reason FROM quota_deferrals WHERE pipeline=? AND job_id=?",
    [job.pipeline, job.id],
  );
  if (
    existing &&
    deferred?.reason === "JOB_TOKEN_CEILING" &&
    limits.job_input_tokens <= existing.input_limit &&
    limits.job_output_tokens <= existing.output_limit
  )
    return deferClaim(db, job.pipeline, job.id, job.tenant, "JOB_TOKEN_CEILING", now);
  if (
    existing &&
    (existing.input_used >= Math.max(existing.input_limit, limits.job_input_tokens) ||
      existing.output_used >= Math.max(existing.output_limit, limits.job_output_tokens))
  )
    return deferClaim(db, job.pipeline, job.id, job.tenant, "JOB_TOKEN_CEILING", now);
  const storm = await db.one<{ n: number }>(
    "SELECT COUNT(*) n FROM quota_calls WHERE tenant_id=? AND pipeline=? AND job_id=? AND status='invalid_output' AND started_at>?",
    [job.tenant, job.pipeline, job.id, existing?.invalid_reviewed_at ?? 0],
  );
  if ((storm?.n ?? 0) >= 5)
    return deferClaim(db, job.pipeline, job.id, job.tenant, "INVALID_OUTPUT_RETRY_STORM", now);
  const active = await db.one<{ n: number }>(
    `SELECT COUNT(*) n FROM quota_jobs WHERE tenant_id=? AND lease_until>? AND closed=0 AND NOT(pipeline=? AND job_id=?)`,
    [job.tenant, now, job.pipeline, job.id],
  );
  if (limits.concurrent_jobs !== null && (active?.n ?? 0) >= limits.concurrent_jobs)
    return deferClaim(db, job.pipeline, job.id, job.tenant, "CONCURRENT_JOBS", now);
  const countDimension =
    job.pipeline === "evaluation"
      ? "evaluations_daily"
      : job.pipeline === "dossier"
        ? "memos_daily"
        : job.pipeline === "pursuit"
          ? "pursuits_monthly"
          : job.pipeline === "scrape"
            ? "scrapes_daily"
            : null;
  if (!existing && countDimension && limits[countDimension] !== null) {
    const period = countDimension === "pursuits_monthly" ? "month" : "day";
    const used = await db.one<{ n: number }>(
      `SELECT COUNT(*) n FROM quota_jobs WHERE tenant_id=? AND pipeline=? AND ${period}=?`,
      [job.tenant, job.pipeline, period === "day" ? day : month],
    );
    if ((used?.n ?? 0) >= limits[countDimension]!)
      return deferClaim(db, job.pipeline, job.id, job.tenant, countDimension.toUpperCase(), now);
  }
  const budgetInput = job.pipeline === "scrape" ? 0 : limits.job_input_tokens;
  const budgetOutput = job.pipeline === "scrape" ? 0 : limits.job_output_tokens;
  const monthly = limits[lane === "reasoning" ? "reasoning_monthly" : "writing_monthly"];
  if (monthly !== null && job.pipeline !== "scrape") {
    const used = await monthlyReserved(db, job.tenant, lane, month, {
      pipeline: job.pipeline,
      id: job.id,
    });
    if (!Number.isFinite(used))
      return deferClaim(db, job.pipeline, job.id, job.tenant, "LEGACY_USAGE_UNMEASURED", now);
    const total =
      used +
      Math.max(0, Math.max(budgetInput, existing?.input_limit ?? 0) - (existing?.input_used ?? 0)) +
      Math.max(
        0,
        Math.max(budgetOutput, existing?.output_limit ?? 0) - (existing?.output_used ?? 0),
      );
    if (total > monthly)
      return deferClaim(db, job.pipeline, job.id, job.tenant, "MONTHLY_TOKEN_RESERVATION", now);
    if (total >= monthly * 0.8)
      await alert(
        db,
        job.tenant,
        "QUOTA_80_PERCENT",
        `${month}:${lane}`,
        `${lane} token reservations reached at least 80% of the monthly limit.`,
        now,
      );
  }
  await db.execute(
    `INSERT INTO quota_jobs(pipeline,job_id,tenant_id,day,month,lane,input_limit,output_limit,lease_token,lease_until)
 VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(pipeline,job_id) DO UPDATE SET lease_token=excluded.lease_token,lease_until=excluded.lease_until,month=excluded.month,
 input_limit=MAX(input_limit,excluded.input_limit),output_limit=MAX(output_limit,excluded.output_limit),closed=0`,
    [
      job.pipeline,
      job.id,
      job.tenant,
      day,
      month,
      lane,
      budgetInput,
      budgetOutput,
      job.token,
      job.leaseUntil,
    ],
  );
  await db.execute("DELETE FROM quota_deferrals WHERE pipeline=? AND job_id=?", [
    job.pipeline,
    job.id,
  ]);
  return true;
}
export async function finishReservation(
  db: DatabaseAdapter,
  pipeline: ProtectedPipeline,
  jobId: string,
  token: string,
  closed: boolean,
) {
  if (!(await protectionInstalled(db))) return;
  await db.execute(
    "UPDATE quota_jobs SET lease_until=0,closed=? WHERE pipeline=? AND job_id=? AND lease_token=?",
    [closed ? 1 : 0, pipeline, jobId, token],
  );
}
export async function renewReservation(
  db: DatabaseAdapter,
  pipeline: ProtectedPipeline,
  jobId: string,
  token: string,
  leaseUntil: number,
) {
  if (!(await protectionInstalled(db))) return;
  await db.execute(
    "UPDATE quota_jobs SET lease_until=? WHERE pipeline=? AND job_id=? AND lease_token=? AND closed=0",
    [leaseUntil, pipeline, jobId, token],
  );
}
function jobIdentity(context: ModelInvocationContext) {
  return {
    evaluation: context.evaluationJobId,
    dossier: context.dossierCompositionJobId,
    factual_review: context.reviewJobId,
    pursuit: context.pursuitPreparationJobId,
  }[context.pipeline];
}
/** Conservative UTF-8 byte admission bound, including schema and framing reserve.
 * Provider output maxima remain hard limits. This is not a vendor tokenizer. */
export async function reserveModelCall(
  db: DatabaseAdapter,
  context: ModelInvocationContext,
  call: {
    id: string;
    instruction: string;
    input: unknown;
    schema?: Record<string, unknown>;
    maxOutput: number;
  },
) {
  if (!(await protectionInstalled(db))) return;
  const limits = await policy(db, context.tenantId, Date.now());
  if (!limits) return;
  const id = jobIdentity(context);
  if (!id || !context.leaseToken) throw new QuotaDeferredError("UNSCOPED_MODEL_JOB");
  if (!Number.isSafeInteger(call.maxOutput) || call.maxOutput < 1)
    throw new QuotaDeferredError("INVALID_OUTPUT_RESERVATION");
  const inputBound =
    Buffer.byteLength(JSON.stringify([call.instruction, call.input, call.schema ?? {}]), "utf8") +
    2048;
  try {
    await db.transaction(async (tx) => {
      const job = await tx.one<{
        input_limit: number;
        output_limit: number;
        input_used: number;
        output_used: number;
        month: string;
        lane: string;
      }>(
        "SELECT * FROM quota_jobs WHERE tenant_id=? AND pipeline=? AND job_id=? AND lease_token=? AND lease_until>? AND closed=0",
        [context.tenantId, context.pipeline, id, context.leaseToken, Date.now()],
      );
      if (!job) {
        // Policy activation does not interrupt already-running, previously unconfigured work.
        const prior = await tx.one(
          "SELECT job_id FROM quota_jobs WHERE tenant_id=? AND pipeline=? AND job_id=?",
          [context.tenantId, context.pipeline, id],
        );
        if (!prior) return;
        throw new QuotaDeferredError("RESERVATION_LEASE_LOST");
      }
      if (
        inputBound + job.input_used > job.input_limit ||
        call.maxOutput + job.output_used > job.output_limit
      )
        throw new QuotaDeferredError("JOB_TOKEN_CEILING");
      const month = new Date().toISOString().slice(0, 7);
      if (month !== job.month) {
        const monthly = limits[job.lane === "reasoning" ? "reasoning_monthly" : "writing_monthly"];
        const reserved = await monthlyReserved(tx, context.tenantId, job.lane, month, {
          pipeline: context.pipeline,
          id,
        });
        if (monthly !== null && !Number.isFinite(reserved))
          throw new QuotaDeferredError("LEGACY_USAGE_UNMEASURED");
        if (
          monthly !== null &&
          reserved + job.input_limit - job.input_used + job.output_limit - job.output_used > monthly
        )
          throw new QuotaDeferredError("MONTHLY_TOKEN_RESERVATION");
        await tx.execute("UPDATE quota_jobs SET month=? WHERE pipeline=? AND job_id=?", [
          month,
          context.pipeline,
          id,
        ]);
      }
      await tx.execute(
        "INSERT INTO quota_calls(id,pipeline,job_id,tenant_id,month,input_reserved,output_reserved,input_charged,output_charged,started_at) VALUES(?,?,?,?,?,?,?,?,?,?)",
        [
          call.id,
          context.pipeline,
          id,
          context.tenantId,
          month,
          inputBound,
          call.maxOutput,
          inputBound,
          call.maxOutput,
          Date.now(),
        ],
      );
      await tx.execute(
        "UPDATE quota_jobs SET input_used=input_used+?,output_used=output_used+? WHERE pipeline=? AND job_id=?",
        [inputBound, call.maxOutput, context.pipeline, id],
      );
    });
  } catch (error) {
    if (
      error instanceof QuotaDeferredError &&
      ["JOB_TOKEN_CEILING", "MONTHLY_TOKEN_RESERVATION", "LEGACY_USAGE_UNMEASURED"].includes(
        error.reason,
      )
    )
      await deferClaim(db, context.pipeline, id, context.tenantId, error.reason);
    throw error;
  }
}
export async function settleModelCall(
  db: DatabaseAdapter,
  context: ModelInvocationContext,
  event: ModelInvocationEvent,
) {
  if (event.status === "running" || !(await protectionInstalled(db))) return;
  await db.transaction(async (tx) => {
    const call = await tx.one<{
      job_id: string;
      input_reserved: number;
      output_reserved: number;
      settled: number;
    }>("SELECT * FROM quota_calls WHERE id=? AND tenant_id=? AND pipeline=?", [
      event.invocationId,
      context.tenantId,
      context.pipeline,
    ]);
    if (!call || call.settled) return;
    const known =
      Number.isSafeInteger(event.usage?.inputTokens) &&
      Number.isSafeInteger(event.usage?.outputTokens) &&
      event.usage!.inputTokens! >= 0 &&
      event.usage!.outputTokens! >= 0;
    const input = known ? event.usage!.inputTokens! : call.input_reserved,
      output = known
        ? Math.max(
            event.usage!.outputTokens! +
              (event.provider === "vertex-gemini" ? (event.usage?.reasoningTokens ?? 0) : 0),
            (event.usage?.totalTokens ?? 0) - input,
          )
        : call.output_reserved;
    await tx.execute(
      "UPDATE quota_calls SET input_charged=?,output_charged=?,settled=1,unknown_usage=?,status=? WHERE id=?",
      [input, output, known ? 0 : 1, event.status, event.invocationId],
    );
    await tx.execute(
      "UPDATE quota_jobs SET input_used=input_used+?,output_used=output_used+? WHERE pipeline=? AND job_id=?",
      [input - call.input_reserved, output - call.output_reserved, context.pipeline, call.job_id],
    );
    if (input > call.input_reserved || output > call.output_reserved)
      await alert(
        tx,
        context.tenantId,
        "PROVIDER_USAGE_OVERRUN",
        event.invocationId,
        "Provider reported usage above the preflight reservation. Further calls require remaining budget.",
      );
  });
}

/** Persistent job ledger shared by all model-backed worker pipelines. */
export class JobTokenLedger {
  constructor(
    private readonly db: DatabaseAdapter,
    private readonly context: ModelInvocationContext,
  ) {}
  reserve(call: Parameters<typeof reserveModelCall>[2]) {
    return reserveModelCall(this.db, this.context, call);
  }
  settle(event: ModelInvocationEvent) {
    return settleModelCall(this.db, this.context, event);
  }
}
