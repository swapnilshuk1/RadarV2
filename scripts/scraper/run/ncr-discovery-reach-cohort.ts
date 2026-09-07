import type { AcquisitionVariant, PortalName } from "../types";

/**
 * A fixed, small experiment for discovery reach across the geography that the
 * active serving policy already calls NCR. The query is intentionally held
 * constant so city/portal reach is the only acquisition variable.
 */
export const NCR_DISCOVERY_REACH_COHORT = {
  id: "ncr-discovery-reach-v1",
  query: "VP Growth",
  locations: ["Gurugram", "Delhi", "Noida", "Faridabad", "Ghaziabad"],
  portals: ["LinkedIn", "Naukri", "Indeed"] as const satisfies readonly PortalName[],
  maxPages: 1,
  maxCardsPerUnit: 5,
} as const;

export function compileNcrDiscoveryReachCohort(): AcquisitionVariant[] {
  return NCR_DISCOVERY_REACH_COHORT.locations.flatMap((location) =>
    NCR_DISCOVERY_REACH_COHORT.portals.map((portal) => ({
      id: `${NCR_DISCOVERY_REACH_COHORT.id}:${location.toLowerCase()}:${portal}`,
      definitionId: NCR_DISCOVERY_REACH_COHORT.id,
      familyId: "vp-growth-geography-control",
      portal,
      query: NCR_DISCOVERY_REACH_COHORT.query,
      requestedTerms: [NCR_DISCOVERY_REACH_COHORT.query],
      location,
      channel: "search" as const,
      postedWithinDays: 7 as const,
      sort: "date" as const,
    })),
  );
}
