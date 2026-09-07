/**
 * Runs the bounded G3 geography/provenance revalidation only. It uses the
 * active immutable NCR context and never changes that context or the plan.
 */
import { getDatabaseAdapter } from "../../src/data/database";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";
import { ScraperPlanResolver } from "../../src/lib/intelligence/ScraperPlanResolver";
import { startRun } from "../scrape";
import { compileG3ReadinessRevalidation, G3_READINESS_REVALIDATION } from "../scraper/run/g3-readiness-revalidation";

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
    throw new Error("G3 revalidation requires an active context with explicit NCR location policy.");
  }
  const variants = compileG3ReadinessRevalidation(plan.criteria.targetLocations?.[0]);
  if (variants.length !== 10) {
    throw new Error(`G3 revalidation integrity failure: expected 10 units, found ${variants.length}.`);
  }

  const { runId, completion } = await startRun({
    authContext,
    searchPlanId: plan.searchPlanId,
    resolvedPlan: plan,
    variants,
    portals: [...G3_READINESS_REVALIDATION.portals],
    maxPages: G3_READINESS_REVALIDATION.maxPages,
    maxCardsPerPage: G3_READINESS_REVALIDATION.maxCardsPerUnit,
    resume: false,
    autoConfirm: true,
  });
  console.log(JSON.stringify({
    status: "started",
    cohortId: G3_READINESS_REVALIDATION.id,
    runId,
    tenantId: scope.tenantId,
    personId: scope.personId,
    contextFingerprint: plan.contextFingerprint,
    locationPolicy: plan.criteria.eligibilitySpec.locationPolicy,
    unitCount: variants.length,
    maxPages: G3_READINESS_REVALIDATION.maxPages,
    maxCardsPerUnit: G3_READINESS_REVALIDATION.maxCardsPerUnit,
  }, null, 2));

  const result = await completion;
  console.log(JSON.stringify({ status: result.success ? "completed" : "failed", ...result }, null, 2));
  if (!result.success) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
