/** Read-only proof that the active NCR context emits the exact G3 portal URLs. */
import { getDatabaseAdapter } from "../../src/data/database";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";
import { ScraperPlanResolver } from "../../src/lib/intelligence/ScraperPlanResolver";
import { compileG3ReadinessRevalidation, G3_READINESS_REVALIDATION } from "../scraper/run/g3-readiness-revalidation";
import { indeedHandler } from "../scraper/portals/indeed";
import { linkedinHandler } from "../scraper/portals/linkedin";
import type { PortalHandler } from "../scraper/types";

const handlers: Record<"LinkedIn" | "Indeed", PortalHandler> = {
  LinkedIn: linkedinHandler,
  Indeed: indeedHandler,
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertUrl(portal: "LinkedIn" | "Indeed", url: URL): void {
  const expected = portal === "Indeed"
    ? [["fromage", "7"], ["sort", "date"]]
    : [["f_TPR", "r604800"], ["sortBy", "DD"]];
  for (const [key, value] of expected) {
    if (url.searchParams.get(key) !== value) {
      throw new Error(`${portal} URL contract failed: expected ${key}=${value}.`);
    }
  }
}

async function main(): Promise<void> {
  const userId = argument("--user-id");
  const requestedTenantId = argument("--tenant-id");
  if (!userId) throw new Error("Usage requires --user-id <authenticated-user-id>.");

  const db = getDatabaseAdapter();
  const { scope, activeContext } = await resolveScraperAuthContext(userId, requestedTenantId, db);
  const plan = await ScraperPlanResolver.resolveActivePlan(scope, activeContext, db);
  if (plan.criteria.eligibilitySpec?.locationPolicy !== "NCR") {
    throw new Error("G3 preflight requires an active NCR context.");
  }
  const variants = compileG3ReadinessRevalidation(plan.criteria.targetLocations?.[0]);
  if (variants.length !== 10) throw new Error(`Expected 10 G3 units, found ${variants.length}.`);

  const portalUrls = variants.map((variant) => {
    const portal = variant.portal;
    if (portal !== "LinkedIn" && portal !== "Indeed") throw new Error("G3 includes an unsupported portal.");
    const url = new URL(handlers[portal].buildSearchUrl({ ...variant, page: 1 }));
    assertUrl(portal, url);
    return { portal, query: variant.query, url: url.toString() };
  });
  console.log(JSON.stringify({
    status: "passed",
    mode: "read-only",
    activePlan: { searchPlanId: plan.searchPlanId, contextFingerprint: plan.contextFingerprint },
    locationPolicy: "NCR",
    cohort: {
      id: G3_READINESS_REVALIDATION.id,
      units: variants.length,
      maxPages: G3_READINESS_REVALIDATION.maxPages,
      maxCardsPerUnit: G3_READINESS_REVALIDATION.maxCardsPerUnit,
      representativeUrls: G3_READINESS_REVALIDATION.portals.map((portal) => portalUrls.find((entry) => entry.portal === portal)?.url),
    },
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
