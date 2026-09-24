import fs from "node:fs";
import path from "node:path";
import {
  getDatabaseAdapter,
  getDatabaseTargetIdentity,
  type DatabaseAdapter,
} from "../../src/data/database";

type Row = Record<string, unknown>;

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

function epochMs(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.length === 0) return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && /^\d{12,}$/.test(value)) return numeric;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function elapsedMs(start: unknown, end: unknown): number | null {
  const a = epochMs(start);
  const b = epochMs(end);
  return a === null || b === null ? null : Math.max(0, b - a);
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(values: Array<number | null>) {
  const present = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return {
    count: present.length,
    p50Ms: percentile(present, 50),
    p95Ms: percentile(present, 95),
    maxMs: present.length ? Math.max(...present) : null,
  };
}

function looks429(value: unknown): boolean {
  return typeof value === "string" && /(429|rate.?limit|throttl)/i.test(value);
}

function looksLocked(value: unknown): boolean {
  return typeof value === "string" &&
    /(SQLITE_BUSY|database is locked|database table is locked|cannot start a transaction within a transaction)/i.test(value);
}

async function tableExists(db: DatabaseAdapter, table: string) {
  return Boolean(await db.one("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [table]));
}

async function enrichmentJobs(db: DatabaseAdapter, runId: string): Promise<Row[]> {
  return db.many<Row>(
    `WITH run_job_ids AS (
       SELECT id FROM enrichment_jobs WHERE run_id=?
       UNION
       SELECT enrichment_job_id
       FROM scrape_run_enrichment_requirements
       WHERE run_id=?
     )
     SELECT ej.id,ej.status,ej.attempts,ej.created_at,ej.started_at,ej.completed_at,
            ej.next_retry_at,ej.failure_type,ej.last_error
     FROM enrichment_jobs ej
     JOIN run_job_ids rj ON rj.id=ej.id
     ORDER BY ej.created_at`,
    [runId, runId],
  );
}

async function enrichmentEvents(db: DatabaseAdapter, runId: string) {
  if (!(await tableExists(db, "enrichment_events"))) return [] as Array<{ event_type: string; n: number }>;
  return db.many<{ event_type: string; n: number }>(
    `WITH run_job_ids AS (
       SELECT id FROM enrichment_jobs WHERE run_id=?
       UNION
       SELECT enrichment_job_id
       FROM scrape_run_enrichment_requirements
       WHERE run_id=?
     )
     SELECT ee.event_type,COUNT(*) AS n
     FROM enrichment_events ee
     JOIN run_job_ids rj ON rj.id=ee.job_id
     GROUP BY ee.event_type`,
    [runId, runId],
  );
}

async function evaluationJobs(db: DatabaseAdapter, runId: string): Promise<Row[]> {
  return db.many<Row>(
    `SELECT DISTINCT
       ej.id,ej.status,ej.attempts,ej.created_at,er.ready_at,
       ej.first_claimed_at,ej.evaluation_persisted_at,ej.dossier_queued_at,
       ej.completed_at,ej.next_attempt_at,ej.last_error
     FROM scrape_run_evaluation_requirements srer
     JOIN evaluation_requirements er ON er.id=srer.evaluation_requirement_id
     JOIN evaluation_jobs ej
       ON ej.tenant_id=er.tenant_id
      AND ej.person_id=er.person_id
      AND ej.search_plan_id=er.search_plan_id
      AND ej.canonical_job_id=er.canonical_job_id
      AND ej.opportunity_version=er.opportunity_version
      AND ej.evaluation_context_fingerprint=er.evaluation_context_fingerprint
     WHERE srer.run_id=?
     ORDER BY ej.created_at`,
    [runId],
  );
}

async function modelInvocations(db: DatabaseAdapter, runId: string): Promise<Row[]> {
  if (!(await tableExists(db, "model_invocations"))) return [];
  return db.many<Row>(
    `SELECT DISTINCT
       mi.id,mi.stage,mi.attempt,mi.status,mi.started_at,mi.completed_at,
       mi.latency_ms,mi.error_code
     FROM scrape_run_evaluation_requirements srer
     JOIN evaluation_requirements er ON er.id=srer.evaluation_requirement_id
     JOIN evaluation_jobs ej
       ON ej.tenant_id=er.tenant_id
      AND ej.person_id=er.person_id
      AND ej.search_plan_id=er.search_plan_id
      AND ej.canonical_job_id=er.canonical_job_id
      AND ej.opportunity_version=er.opportunity_version
      AND ej.evaluation_context_fingerprint=er.evaluation_context_fingerprint
     JOIN model_invocations mi ON mi.evaluation_job_id=ej.id
     WHERE srer.run_id=? AND mi.pipeline='evaluation'
     ORDER BY mi.started_at`,
    [runId],
  );
}

function stageSummary(rows: Row[]) {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const stage = String(row.stage ?? "unknown");
    const bucket = grouped.get(stage) ?? [];
    bucket.push(row);
    grouped.set(stage, bucket);
  }

  return Object.fromEntries(
    [...grouped.entries()].map(([stage, stageRows]) => [
      stage,
      {
        invocations: stageRows.length,
        latency: summarize(
          stageRows.map((row) => {
            const direct = Number(row.latency_ms);
            return Number.isFinite(direct) ? direct : elapsedMs(row.started_at, row.completed_at);
          }),
        ),
        retries: stageRows.filter((row) => Number(row.attempt ?? 0) > 1).length,
        errors: stageRows.filter((row) => String(row.status ?? "").toLowerCase().includes("error") || row.error_code).length,
        rateLimits: stageRows.filter((row) => looks429(row.error_code)).length,
        sqliteLockErrors: stageRows.filter((row) => looksLocked(row.error_code)).length,
      },
    ]),
  );
}

async function main() {
  const runId = arg("run-id");
  if (!runId) {
    throw new Error("Usage: npm run sqlite:baseline -- --run-id=<scrape-run-id> [--out=<file.json>]");
  }

  const db = getDatabaseAdapter();
  const identity = getDatabaseTargetIdentity();
  const capturedAt = new Date().toISOString();
  const now = Date.now();
  const [enrichment, events, evaluations, models] = await Promise.all([
    enrichmentJobs(db, runId),
    enrichmentEvents(db, runId),
    evaluationJobs(db, runId),
    modelInvocations(db, runId),
  ]);

  if (!enrichment.length && !evaluations.length) {
    throw new Error(`No enrichment/evaluation rows found for run ${runId}`);
  }

  const eventCounts = Object.fromEntries(events.map((row) => [row.event_type, Number(row.n)]));
  const activeEnrichment = new Set(["PENDING", "LEASED", "RUNNING", "RETRY"]);
  const activeEvaluation = new Set(["pending", "processing", "staged_pending", "staged_processing"]);

  const report = {
    schemaVersion: 1,
    capturedAt,
    runId,
    database: identity,
    enrichment: {
      jobs: enrichment.length,
      queuedToStarted: summarize(enrichment.map((row) => elapsedMs(row.created_at, row.started_at))),
      startedToCompleted: summarize(enrichment.map((row) => elapsedMs(row.started_at, row.completed_at))),
      queuedToCompleted: summarize(enrichment.map((row) => elapsedMs(row.created_at, row.completed_at))),
      queueAge: summarize(
        enrichment.map((row) => {
          const created = epochMs(row.created_at);
          return activeEnrichment.has(String(row.status)) && created !== null ? now - created : null;
        }),
      ),
      retries:
        Number(eventCounts.RETRY_SCHEDULED ?? 0) +
        Number(eventCounts.LLM_RATE_LIMITED ?? 0) +
        Number(eventCounts.MANUAL_RETRY ?? 0),
      rateLimits:
        Number(eventCounts.LLM_RATE_LIMITED ?? 0) +
        enrichment.filter((row) => looks429(row.failure_type) || looks429(row.last_error)).length,
      sqliteLockErrors: enrichment.filter((row) => looksLocked(row.last_error)).length,
      eventCounts,
      statusCounts: Object.fromEntries(
        [...new Set(enrichment.map((row) => String(row.status)))].map((status) => [
          status,
          enrichment.filter((row) => String(row.status) === status).length,
        ]),
      ),
    },
    evaluation: {
      jobs: evaluations.length,
      readyToFirstClaim: summarize(evaluations.map((row) => elapsedMs(row.ready_at, row.first_claimed_at))),
      firstClaimToPersisted: summarize(evaluations.map((row) => elapsedMs(row.first_claimed_at, row.evaluation_persisted_at))),
      readyToPersisted: summarize(evaluations.map((row) => elapsedMs(row.ready_at, row.evaluation_persisted_at))),
      readyToCompleted: summarize(evaluations.map((row) => elapsedMs(row.ready_at, row.completed_at))),
      queueAge: summarize(
        evaluations.map((row) => {
          const ready = epochMs(row.ready_at);
          return activeEvaluation.has(String(row.status)) && ready !== null ? now - ready : null;
        }),
      ),
      retries: evaluations.reduce((sum, row) => sum + Number(row.attempts ?? 0), 0),
      rateLimits: evaluations.filter((row) => looks429(row.last_error)).length,
      sqliteLockErrors: evaluations.filter((row) => looksLocked(row.last_error)).length,
      statusCounts: Object.fromEntries(
        [...new Set(evaluations.map((row) => String(row.status)))].map((status) => [
          status,
          evaluations.filter((row) => String(row.status) === status).length,
        ]),
      ),
    },
    modelInvocations: {
      rows: models.length,
      byStage: stageSummary(models),
      total429s: models.filter((row) => looks429(row.error_code)).length,
      totalSqliteLockErrors: models.filter((row) => looksLocked(row.error_code)).length,
    },
  };

  const output = JSON.stringify(report, null, 2);
  console.log(output);

  const out = arg("out");
  if (out) {
    const resolved = path.resolve(out);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, output + "\n", "utf8");
  }
}

main().catch((error) => {
  console.error("[SQLiteReadinessBaseline] failed:", error);
  process.exitCode = 1;
});
