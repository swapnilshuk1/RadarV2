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
export interface CompileVariantsOptions {
  readonly expandAllLocations?: boolean;
}

export function compileCoverageVariants(
  plan: ResolvedScraperPlan,
  portals: PortalName[],
  options?: CompileVariantsOptions
): AcquisitionVariant[] {
  const criteria = plan.criteria;
  const locations = Array.isArray(criteria.targetLocations) && criteria.targetLocations.length > 0
    ? criteria.targetLocations
    : [undefined];
  const targetLocs = options?.expandAllLocations ? locations : [locations[0]];
  const industries = Array.isArray(criteria.targetIndustries) ? criteria.targetIndustries : [];
  const custom = (criteria.customParameters || {}) as Record<string, unknown>;
  const departments = Array.isArray(custom.departments)
    ? custom.departments.filter((v): v is string => typeof v === "string")
    : [];

  const variants: AcquisitionVariant[] = [];
  for (const portal of portals) {
    for (const query of plan.queries) {
      for (const loc of targetLocs) {
        variants.push({
          id: `${plan.searchPlanId}:${portal}:${query}:${loc || "global"}`,
          definitionId: plan.searchPlanId,
          portal,
          query,
          requestedTerms: [query],
          location: loc,
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
  }
  return variants;
}

/**
 * Compiles coverage variants expanding across all target locations declared in the search plan.
 */
export function compileMultiLocationCoverageVariants(
  plan: ResolvedScraperPlan,
  portals: PortalName[]
): AcquisitionVariant[] {
  return compileCoverageVariants(plan, portals, { expandAllLocations: true });
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

/** Creates an adaptive subsequent-page variant for a given work unit. */
export function createAdaptivePageVariant(
  variant: AcquisitionVariant,
  nextPage: number
): AcquisitionVariant & { page: number } {
  return {
    ...variant,
    id: `${variant.id || variant.query}:p${nextPage}`,
    page: nextPage,
  };
}

export interface SourceNoveltyEvaluation {
  readonly totalDiscovered: number;
  readonly uniqueSourceIdentities: number;
  readonly novelCount: number;
  readonly noveltyRatio: number;
  readonly shouldDeepen: boolean;
  readonly shouldContinue: boolean;
}

/**
 * Evaluates source-identity novelty (ratio of unseen source job IDs).
 * Downstream canonical/accepted novelty must NEVER be used for source deepening.
 */
export function evaluateSourceNovelty(
  discoveredJobIds: readonly string[],
  previouslySeenJobIds: ReadonlySet<string>,
  minNoveltyRatio: number = 0.25
): SourceNoveltyEvaluation {
  const total = discoveredJobIds.length;
  if (total === 0) {
    return {
      totalDiscovered: 0,
      uniqueSourceIdentities: 0,
      novelCount: 0,
      noveltyRatio: 0,
      shouldDeepen: false,
      shouldContinue: false,
    };
  }

  let novelCount = 0;
  for (const id of discoveredJobIds) {
    if (!previouslySeenJobIds.has(id)) {
      novelCount++;
    }
  }

  const noveltyRatio = novelCount / total;
  const passesThreshold = noveltyRatio >= minNoveltyRatio;
  return {
    totalDiscovered: total,
    uniqueSourceIdentities: novelCount,
    novelCount,
    noveltyRatio,
    shouldDeepen: passesThreshold,
    shouldContinue: passesThreshold,
  };
}
