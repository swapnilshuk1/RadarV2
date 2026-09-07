/**
 * Removes only the candidate projections conclusively created by the
 * pre-fix G3 authenticated-ingestion scope defect.
 *
 * The run's public canonical opportunities, source lineage, snapshots, and
 * owner-scope candidates are intentionally untouched. Default mode is a
 * read-only preflight; --apply requires the exact expected row count.
 */
import { getDatabaseAdapter } from "../../src/data/database";
import type { DatabaseAdapter } from "../../src/data/database/adapter";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

interface CleanupWindow {
  runId: string;
  tenantId: string;
  personId: string;
  createdAt: string;
  finishedAt: string;
}

function predicate(): string {
  return `NOT (spc.tenant_id = ? AND spc.person_id = ?)
      AND datetime(spc.created_at) >= datetime(?)
      AND datetime(spc.created_at) <= datetime(?)
      AND EXISTS (
        SELECT 1 FROM acquisition_ingestion_lineage ail
         WHERE ail.scrape_run_id = ?
           AND ail.canonical_job_id = spc.canonical_job_id
           AND ail.opportunity_version = spc.opportunity_version
      )`;
}

function parameters(window: CleanupWindow): readonly unknown[] {
  return [window.tenantId, window.personId, window.createdAt, window.finishedAt, window.runId];
}

async function countCandidates(db: DatabaseAdapter, window: CleanupWindow): Promise<number> {
  const row = await db.one<{ count: number }>(
    `SELECT COUNT(*) AS count FROM search_plan_candidates spc WHERE ${predicate()}`,
    parameters(window),
  );
  return row?.count || 0;
}

async function countDependents(db: DatabaseAdapter, window: CleanupWindow): Promise<{ evaluationJobs: number; materializedEvaluations: number }> {
  const evaluationJobs = await db.one<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM evaluation_jobs ej
       JOIN search_plan_candidates spc
         ON spc.tenant_id = ej.tenant_id AND spc.person_id = ej.person_id
        AND spc.search_plan_id = ej.search_plan_id AND spc.canonical_job_id = ej.canonical_job_id
        AND spc.opportunity_version = ej.opportunity_version
      WHERE ${predicate()}`,
    parameters(window),
  );
  const materializedEvaluations = await db.one<{ count: number }>(
    `SELECT COUNT(*) AS count
       FROM materialized_evaluations me
       JOIN search_plan_candidates spc
         ON spc.tenant_id = me.tenant_id AND spc.person_id = me.person_id
        AND spc.canonical_job_id = me.canonical_job_id AND spc.opportunity_version = me.opportunity_version
      WHERE ${predicate()}`,
    parameters(window),
  );
  return { evaluationJobs: evaluationJobs?.count || 0, materializedEvaluations: materializedEvaluations?.count || 0 };
}

async function main(): Promise<void> {
  const userId = argument("--user-id");
  const requestedTenantId = argument("--tenant-id");
  const runId = argument("--run-id");
  const apply = process.argv.includes("--apply");
  const expectedCount = Number(argument("--expected-count"));
  if (!userId || !runId) throw new Error("Usage requires --user-id <authenticated-user-id> --run-id <run-id>.");
  if (apply && (!Number.isInteger(expectedCount) || expectedCount < 1)) {
    throw new Error("--apply requires a positive integer --expected-count confirmed from the attribution report.");
  }

  const db = getDatabaseAdapter();
  const { scope } = await resolveScraperAuthContext(userId, requestedTenantId, db);
  const run = await db.one<{ created_at: string; finished_at: string | null; status: string }>(
    `SELECT created_at, finished_at, status FROM scrape_runs
      WHERE id = ? AND tenant_id = ? AND person_id = ?`,
    [runId, scope.tenantId, scope.personId],
  );
  if (!run || run.status !== "completed" || !run.finished_at) {
    throw new Error("Cleanup requires a completed, owner-scoped run with a durable finish timestamp.");
  }
  const window: CleanupWindow = {
    runId,
    tenantId: scope.tenantId,
    personId: scope.personId,
    createdAt: run.created_at,
    finishedAt: run.finished_at,
  };
  const count = await countCandidates(db, window);
  const dependents = await countDependents(db, window);
  const preflight = { mode: apply ? "apply" : "preflight", run: window, candidateRows: count, dependents };
  if (!apply) {
    console.log(JSON.stringify({ ...preflight, disposition: "read-only: no mutation performed" }, null, 2));
    return;
  }
  if (count !== expectedCount) {
    throw new Error(`Cleanup refused: expected ${expectedCount} attributable rows, found ${count}.`);
  }
  if (dependents.evaluationJobs !== 0 || dependents.materializedEvaluations !== 0) {
    throw new Error(`Cleanup refused: dependent rows exist (evaluation_jobs=${dependents.evaluationJobs}, materialized_evaluations=${dependents.materializedEvaluations}).`);
  }

  const deleted = await db.transaction(async (tx) => {
    const insideCount = await countCandidates(tx, window);
    const insideDependents = await countDependents(tx, window);
    if (insideCount !== expectedCount || insideDependents.evaluationJobs !== 0 || insideDependents.materializedEvaluations !== 0) {
      throw new Error("Cleanup refused inside transaction: live attribution or dependency state changed.");
    }
    const result = await tx.execute(
      `DELETE FROM search_plan_candidates AS spc WHERE ${predicate()}`,
      parameters(window),
    );
    if (result.rowsAffected !== expectedCount) {
      throw new Error(`Cleanup rollback: expected to delete ${expectedCount} rows, deleted ${result.rowsAffected}.`);
    }
    const remaining = await countCandidates(tx, window);
    if (remaining !== 0) throw new Error(`Cleanup rollback: ${remaining} attributable rows remain.`);
    return result.rowsAffected;
  });

  console.log(JSON.stringify({ ...preflight, deleted, postflight: "passed" }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
