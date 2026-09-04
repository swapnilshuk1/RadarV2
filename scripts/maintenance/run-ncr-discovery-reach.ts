/** Runs the fixed NCR discovery-reach cohort without changing the active plan. */
import { getDatabaseAdapter } from "../../src/data/database";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";
import { ScraperPlanResolver } from "../../src/lib/intelligence/ScraperPlanResolver";
import { startRun } from "../scrape";
import { compileNcrDiscoveryReachCohort, NCR_DISCOVERY_REACH_COHORT } from "../scraper/run/ncr-discovery-reach-cohort";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const userId = argument("--user-id");
  const requestedTenantId = argument("--tenant-id");
  if (!userId) throw new Error("Usage requires --user-id <authenticated-user-id>.");

  const db = getDatabaseAdapter();
  const { authContext, scope, activeContext } = await resolveScraperAuthContext(userId, requestedTenantId, db);
  const plan = await ScraperPlanResolver.resolveActivePlan(scope, activeContext, db);
  if (plan.criteria.eligibilitySpec?.locationPolicy !== "NCR") {
    throw new Error("NCR discovery reach requires an active NCR serving policy.");
  }
  const variants = compileNcrDiscoveryReachCohort();
  if (variants.length !== 15) throw new Error(`NCR discovery reach must contain 15 units, found ${variants.length}.`);

  const { runId, completion } = await startRun({
    authContext,
    searchPlanId: plan.searchPlanId,
    resolvedPlan: plan,
    variants,
    portals: [...NCR_DISCOVERY_REACH_COHORT.portals],
    maxPages: NCR_DISCOVERY_REACH_COHORT.maxPages,
    maxCardsPerPage: NCR_DISCOVERY_REACH_COHORT.maxCardsPerUnit,
    resume: false,
    autoConfirm: true,
  });
  console.log(JSON.stringify({
    status: "started",
    cohortId: NCR_DISCOVERY_REACH_COHORT.id,
    runId,
    tenantId: scope.tenantId,
    personId: scope.personId,
    contextFingerprint: plan.contextFingerprint,
    unitCount: variants.length,
    maxPages: NCR_DISCOVERY_REACH_COHORT.maxPages,
    maxCardsPerUnit: NCR_DISCOVERY_REACH_COHORT.maxCardsPerUnit,
  }, null, 2));
  const result = await completion;
  console.log(JSON.stringify({ status: result.success ? "completed" : "failed", ...result }, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
