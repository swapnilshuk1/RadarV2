/**
 * Read-only attribution report for the authenticated-ingestion scope defect.
 *
 * A candidate row is cleanup-eligible only when it belongs to a scope other
 * than the run owner, references an exact lineage job/version pair, and was
 * created during the durable run interval. Rows outside that interval remain
 * unmodified because they may predate the defective run.
 */
import { getDatabaseAdapter } from "../../src/data/database";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

type ProjectionRow = {
  tenant_id: string;
  person_id: string;
  search_plan_id: string;
  first_created_at: string;
  last_created_at: string;
  count: number;
};

async function main(): Promise<void> {
  const userId = argument("--user-id");
  const requestedTenantId = argument("--tenant-id");
  const runId = argument("--run-id");
  if (!userId || !runId) throw new Error("Usage requires --user-id <authenticated-user-id> --run-id <run-id>.");

  const db = getDatabaseAdapter();
  const { scope } = await resolveScraperAuthContext(userId, requestedTenantId, db);
  const run = await db.one<{ created_at: string; finished_at: string | null; status: string }>(
    `SELECT created_at, finished_at, status
       FROM scrape_runs
      WHERE id = ? AND tenant_id = ? AND person_id = ?`,
    [runId, scope.tenantId, scope.personId],
  );
  if (!run || run.status !== "completed" || !run.finished_at) {
    throw new Error("Attribution requires a completed run with a durable finish timestamp.");
  }

  const totalCrossScope = await db.many<ProjectionRow>(
    `SELECT spc.tenant_id, spc.person_id, spc.search_plan_id,
            MIN(spc.created_at) AS first_created_at, MAX(spc.created_at) AS last_created_at,
            COUNT(*) AS count
       FROM search_plan_candidates spc
       JOIN acquisition_ingestion_lineage ail
         ON ail.canonical_job_id = spc.canonical_job_id AND ail.opportunity_version = spc.opportunity_version
      WHERE ail.scrape_run_id = ?
        AND NOT (spc.tenant_id = ? AND spc.person_id = ?)
      GROUP BY spc.tenant_id, spc.person_id, spc.search_plan_id
      ORDER BY spc.tenant_id, spc.person_id, spc.search_plan_id`,
    [runId, scope.tenantId, scope.personId],
  );
  const cleanupEligible = await db.many<ProjectionRow>(
    `SELECT spc.tenant_id, spc.person_id, spc.search_plan_id,
            MIN(spc.created_at) AS first_created_at, MAX(spc.created_at) AS last_created_at,
            COUNT(*) AS count
       FROM search_plan_candidates spc
       JOIN acquisition_ingestion_lineage ail
         ON ail.canonical_job_id = spc.canonical_job_id AND ail.opportunity_version = spc.opportunity_version
      WHERE ail.scrape_run_id = ?
        AND NOT (spc.tenant_id = ? AND spc.person_id = ?)
        AND datetime(spc.created_at) >= datetime(?)
        AND datetime(spc.created_at) <= datetime(?)
      GROUP BY spc.tenant_id, spc.person_id, spc.search_plan_id
      ORDER BY spc.tenant_id, spc.person_id, spc.search_plan_id`,
    [runId, scope.tenantId, scope.personId, run.created_at, run.finished_at],
  );
  const eligibleCount = cleanupEligible.reduce((sum, row) => sum + row.count, 0);
  const totalCount = totalCrossScope.reduce((sum, row) => sum + row.count, 0);

  console.log(JSON.stringify({
    status: "read-only-complete",
    run: { id: runId, status: run.status, createdAt: run.created_at, finishedAt: run.finished_at },
    runScope: scope,
    totalCrossScopeProjectionRows: totalCount,
    cleanupEligibleProjectionRows: eligibleCount,
    protectedProjectionRows: totalCount - eligibleCount,
    cleanupEligibleScopes: cleanupEligible,
    protectedScopes: totalCrossScope.filter((row) => !cleanupEligible.some((eligible) =>
      eligible.tenant_id === row.tenant_id
      && eligible.person_id === row.person_id
      && eligible.search_plan_id === row.search_plan_id,
    )),
    proposedDeleteKey: "tenant_id + person_id + search_plan_id + canonical_job_id + opportunity_version",
    disposition: eligibleCount > 0
      ? "approval-required: eligible rows are attributable; no mutation performed"
      : "no-attributable-rows: no cleanup proposed",
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
