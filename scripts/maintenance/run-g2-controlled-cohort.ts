/**
 * Explicit launcher for the one-shot G2 controlled acquisition cohort.
 * It does not modify the tenant's active plan or evaluation context.
 *
 * Usage:
 *   npx tsx scripts/maintenance/run-g2-controlled-cohort.ts \
 *     --user-id <authenticated-user-id> [--tenant-id <tenant-id>]
 */
import { getDatabaseAdapter } from "../../src/data/database";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";
import { ScraperPlanResolver } from "../../src/lib/intelligence/ScraperPlanResolver";
import { startRun } from "../scrape";
import { compileG2ControlledCohort, G2_CONTROLLED_COHORT } from "../scraper/run/g2-controlled-cohort";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const userId = argument("--user-id");
  const requestedTenantId = argument("--tenant-id");
  if (!userId) throw new Error("Usage requires --user-id <authenticated-user-id>.");

  const db = getDatabaseAdapter();
  const { authContext, scope, activeContext } = await resolveScraperAuthContext(userId, requestedTenantId, db);
  const plan = await ScraperPlanResolver.resolveActivePlan(scope, activeContext, db);
  const variants = compileG2ControlledCohort(plan.criteria.targetLocations?.[0]);

  if (variants.length !== 15) {
    throw new Error(`G2 cohort integrity failure: expected 15 units, found ${variants.length}.`);
  }

  const { runId, completion } = await startRun({
    authContext,
    searchPlanId: plan.searchPlanId,
    resolvedPlan: plan,
    variants,
    portals: [...G2_CONTROLLED_COHORT.portals],
    maxPages: G2_CONTROLLED_COHORT.maxPages,
    maxCardsPerPage: G2_CONTROLLED_COHORT.maxCardsPerUnit,
    resume: false,
    autoConfirm: true,
  });

  console.log(JSON.stringify({
    status: "started",
    cohortId: G2_CONTROLLED_COHORT.id,
    runId,
    tenantId: scope.tenantId,
    personId: scope.personId,
    unitCount: variants.length,
    maxPages: G2_CONTROLLED_COHORT.maxPages,
    maxCardsPerUnit: G2_CONTROLLED_COHORT.maxCardsPerUnit,
  }, null, 2));

  const result = await completion;
  console.log(JSON.stringify({ status: result.success ? "completed" : "failed", ...result }, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
