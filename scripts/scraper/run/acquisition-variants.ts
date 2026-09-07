import type { PortalName, AcquisitionVariant } from "../types";
import type { ResolvedScraperPlan } from "../../../src/lib/intelligence/ScraperPlanResolver";

/**
 * Compiles the resolved, tenant-scoped search plan into executable portal
 * variants without changing the canonical opportunity pipeline.
 *
 * The default lane is a bounded seven-day, date-sorted coverage surface. This
 * preserves a useful freshness floor for every initial portal request while
 * the adaptive scheduler may still narrow a low-yield surface to one day.
 */
export function compileCoverageVariants(
  plan: ResolvedScraperPlan,
  portals: PortalName[]
): AcquisitionVariant[] {
  const criteria = plan.criteria;
  const locations = Array.isArray(criteria.targetLocations) && criteria.targetLocations.length > 0
    ? criteria.targetLocations
    : [undefined];
  const industries = Array.isArray(criteria.targetIndustries) ? criteria.targetIndustries : [];
  const custom = (criteria.customParameters || {}) as Record<string, unknown>;
  const departments = Array.isArray(custom.departments)
    ? custom.departments.filter((v): v is string => typeof v === "string")
    : [];

  const variants: AcquisitionVariant[] = [];
  for (const portal of portals) {
    for (const query of plan.queries) {
      // Keep the initial plan bounded: use the first location and industry as
      // the coverage surface. Additional dimensions are planner fallbacks.
      variants.push({
        id: `${plan.searchPlanId}:${portal}:${query}:${locations[0] || "global"}`,
        definitionId: plan.searchPlanId,
        portal,
        query,
        requestedTerms: [query],
        location: locations[0],
        industry: industries[0],
        department: departments[0],
        channel: "search",
        // Portal builders translate this shared execution constraint into
        // Indeed `fromage`, Naukri `jobAge`, and LinkedIn `f_TPR`.
        postedWithinDays: 7,
        sort: "date",
      });
    }
  }
  return variants;
}

/** Creates a freshness lens for a previously executed coverage variant. */
export function createFreshnessVariant(
  variant: AcquisitionVariant,
  postedWithinDays: 1 | 7
): AcquisitionVariant {
  return {
    ...variant,
    id: `${variant.id || variant.query}:fresh-${postedWithinDays}`,
    postedWithinDays,
    sort: "date",
  };
}
