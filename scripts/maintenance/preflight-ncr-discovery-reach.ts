/** Read-only contract proof for the bounded NCR discovery-reach cohort. */
import { getDatabaseAdapter } from "../../src/data/database";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";
import { ScraperPlanResolver } from "../../src/lib/intelligence/ScraperPlanResolver";
import { indeedHandler } from "../scraper/portals/indeed";
import { linkedinHandler, resolveLinkedInGeoId } from "../scraper/portals/linkedin";
import { naukriHandler } from "../scraper/portals/naukri";
import { compileNcrDiscoveryReachCohort, NCR_DISCOVERY_REACH_COHORT } from "../scraper/run/ncr-discovery-reach-cohort";
import type { PortalHandler, PortalName } from "../scraper/types";

const handlers: Record<PortalName, PortalHandler> = {
  LinkedIn: linkedinHandler,
  Naukri: naukriHandler,
  Indeed: indeedHandler,
};

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertFreshness(portal: PortalName, url: URL): void {
  const expected = portal === "Indeed"
    ? [["fromage", "7"], ["sort", "date"]]
    : portal === "Naukri"
      ? [["jobAge", "7"], ["sort", "r"]]
      : [["f_TPR", "r604800"], ["sortBy", "DD"]];
  for (const [key, value] of expected) {
    if (url.searchParams.get(key) !== value) throw new Error(`${portal} URL is missing ${key}=${value}.`);
  }
}

function assertLocation(portal: PortalName, location: string, url: URL): void {
  if (portal === "LinkedIn") {
    const expectedGeoId = resolveLinkedInGeoId(location);
    if (!expectedGeoId) throw new Error(`LinkedIn has no verified geo ID for explicit NCR location "${location}".`);
    if (url.searchParams.get("geoId") !== expectedGeoId) {
      throw new Error(`LinkedIn URL for "${location}" must use geoId=${expectedGeoId}, not ${url.searchParams.get("geoId") ?? "none"}.`);
    }
  }
  if (portal === "Indeed" && url.searchParams.get("l") !== location) {
    throw new Error(`Indeed URL location mismatch for "${location}".`);
  }
  if (portal === "Naukri" && url.searchParams.get("l") !== location) {
    throw new Error(`Naukri URL location mismatch for "${location}".`);
  }
}

async function main(): Promise<void> {
  const userId = argument("--user-id");
  const requestedTenantId = argument("--tenant-id");
  if (!userId) throw new Error("Usage requires --user-id <authenticated-user-id>.");

  const db = getDatabaseAdapter();
  const { scope, activeContext, membership } = await resolveScraperAuthContext(userId, requestedTenantId, db);
  const plan = await ScraperPlanResolver.resolveActivePlan(scope, activeContext, db);
  if (plan.criteria.eligibilitySpec?.locationPolicy !== "NCR") {
    throw new Error("NCR discovery reach requires an active NCR serving policy.");
  }

  const variants = compileNcrDiscoveryReachCohort();
  const expectedUnits = NCR_DISCOVERY_REACH_COHORT.locations.length * NCR_DISCOVERY_REACH_COHORT.portals.length;
  if (variants.length !== expectedUnits) throw new Error(`Expected ${expectedUnits} discovery surfaces, found ${variants.length}.`);
  const emitted = variants.map((variant) => {
    const url = new URL(handlers[variant.portal!].buildSearchUrl({ ...variant, page: 1 }));
    assertFreshness(variant.portal!, url);
    assertLocation(variant.portal!, variant.location!, url);
    return { portal: variant.portal, location: variant.location, url: url.toString() };
  });

  console.log(JSON.stringify({
    status: "passed",
    mode: "read-only",
    authorizedScope: { tenantId: scope.tenantId, personId: scope.personId, role: membership.role },
    activePlan: { searchPlanId: plan.searchPlanId, contextFingerprint: plan.contextFingerprint, locationPolicy: "NCR" },
    cohort: {
      id: NCR_DISCOVERY_REACH_COHORT.id,
      query: NCR_DISCOVERY_REACH_COHORT.query,
      locations: NCR_DISCOVERY_REACH_COHORT.locations,
      portals: NCR_DISCOVERY_REACH_COHORT.portals,
      unitCount: variants.length,
      maxPages: NCR_DISCOVERY_REACH_COHORT.maxPages,
      maxCardsPerUnit: NCR_DISCOVERY_REACH_COHORT.maxCardsPerUnit,
      verifiedUrls: emitted,
    },
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
