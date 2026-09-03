/**
 * Read-only preflight for the controlled G2 acquisition cohort.
 *
 * It does not create a run, access a portal, write artifacts, or alter Turso.
 * It proves the exact persisted active plan compiles into portal URLs with the
 * required seven-day freshness filters before a live run is allowed.
 *
 * Usage:
 *   npx tsx scripts/maintenance/preflight-g2-acquisition-validation.ts \
 *     --user-id <authenticated-user-id> [--tenant-id <tenant-id>]
 */
import { getDatabaseAdapter } from "../../src/data/database";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";
import { ScraperPlanResolver } from "../../src/lib/intelligence/ScraperPlanResolver";
import { compileG2ControlledCohort, G2_CONTROLLED_COHORT } from "../scraper/run/g2-controlled-cohort";
import { indeedHandler } from "../scraper/portals/indeed";
import { linkedinHandler } from "../scraper/portals/linkedin";
import { naukriHandler } from "../scraper/portals/naukri";
import type { PortalHandler, PortalName } from "../scraper/types";

const handlers: Record<PortalName, PortalHandler> = {
  LinkedIn: linkedinHandler,
  Naukri: naukriHandler,
  Indeed: indeedHandler,
};
const requiredMigrations = [
  "033_opportunity_version_source_payload.sql",
  "034_acquisition_ingestion_lineage.sql",
  "035_search_plan_candidate_eligibility_audit.sql",
] as const;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function assertUrlContract(portal: PortalName, url: URL): void {
  const expected = portal === "Indeed"
    ? [["fromage", "7"], ["sort", "date"]]
    : portal === "Naukri"
      ? [["jobAge", "7"], ["sort", "r"]]
      : [["f_TPR", "r604800"], ["sortBy", "DD"]];
  for (const [parameter, value] of expected) {
    if (url.searchParams.get(parameter) !== value) {
      throw new Error(`${portal} URL contract failed: expected ${parameter}=${value}, got ${url.searchParams.get(parameter) ?? "<absent>"}.`);
    }
  }
}

async function main() {
  const userId = argument("--user-id");
  const requestedTenantId = argument("--tenant-id");
  if (!userId) {
    throw new Error("Usage requires --user-id <authenticated-user-id>.");
  }

  const db = getDatabaseAdapter();
  const applied = await db.many<{ migration_name: string }>(
    "SELECT migration_name FROM _migrations WHERE migration_name IN (?, ?, ?)",
    [...requiredMigrations],
  );
  const appliedNames = new Set(applied.map((row) => row.migration_name));
  const missingMigrations = requiredMigrations.filter((migration) => !appliedNames.has(migration));
  if (missingMigrations.length > 0) {
    throw new Error(`Required acquisition schema migrations are absent: ${missingMigrations.join(", ")}.`);
  }

  const { scope, activeContext, membership } = await resolveScraperAuthContext(userId, requestedTenantId, db);
  const plan = await ScraperPlanResolver.resolveActivePlan(scope, activeContext, db);
  const effectiveLocation = plan.criteria.targetLocations?.[0];
  const variants = compileG2ControlledCohort(effectiveLocation);
  if (variants.length !== 15) {
    throw new Error(`The controlled G2 cohort must contain 15 units; found ${variants.length}.`);
  }

  const emittedUrls = variants.map((variant) => {
    if (!variant.portal) throw new Error(`Compiled variant '${variant.query}' has no portal.`);
    if (variant.postedWithinDays !== 7 || variant.sort !== "date") {
      throw new Error(`Compiled variant '${variant.id ?? variant.query}' is missing the default seven-day date constraint.`);
    }
    const url = new URL(handlers[variant.portal].buildSearchUrl({ ...variant, page: 1 }));
    assertUrlContract(variant.portal, url);
    return {
      portal: variant.portal,
      query: variant.query,
      location: variant.location ?? null,
      url: url.toString(),
    };
  });

  console.log(JSON.stringify({
    status: "passed",
    mode: "read-only",
    schemaMigrations: [...appliedNames].sort(),
    authorizedScope: {
      tenantId: scope.tenantId,
      personId: scope.personId,
      role: membership.role,
    },
    activePlan: {
      searchPlanId: plan.searchPlanId,
      snapshotId: plan.snapshotId ?? null,
      contextFingerprint: plan.contextFingerprint ?? null,
      queryCount: plan.queryCount,
    },
    execution: {
      cohortId: G2_CONTROLLED_COHORT.id,
      portals: G2_CONTROLLED_COHORT.portals,
      postedWithinDays: 7,
      sort: "date",
      maxPages: G2_CONTROLLED_COHORT.maxPages,
      maxCardsPerUnit: G2_CONTROLLED_COHORT.maxCardsPerUnit,
      variantCount: variants.length,
      // Every URL above was asserted. Report one representative URL per portal
      // so the preflight stays legible even when a plan has many query families.
      portalContracts: G2_CONTROLLED_COHORT.portals.map((portal) => {
        const portalUrls = emittedUrls.filter((entry) => entry.portal === portal);
        return {
          portal,
          verifiedQueryFamilies: portalUrls.length,
          representativeUrl: portalUrls[0]?.url ?? null,
        };
      }),
    },
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
