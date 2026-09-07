import type { AcquisitionVariant, PortalName } from "../types";

/**
 * Small G3 revalidation surface for the two portals that returned out-of-area
 * discovery cards in G2. It deliberately reuses the five controlled families,
 * but excludes Naukri because its G2 sample already respected the geography.
 */
export const G3_READINESS_REVALIDATION = {
  id: "g3-ncr-geography-provenance-v1",
  maxPages: 1,
  maxCardsPerUnit: 10,
  portals: ["LinkedIn", "Indeed"] as const satisfies readonly PortalName[],
  families: [
    { id: "vp-client-services", query: "VP Client Services" },
    { id: "vp-client-experience", query: "VP Client Experience" },
    { id: "chief-transformation", query: "Chief Transformation Officer" },
    { id: "vp-growth-marketing", query: "VP Growth" },
    { id: "vp-engineering-control", query: "VP Engineering" },
  ],
} as const;

export function compileG3ReadinessRevalidation(location?: string): AcquisitionVariant[] {
  return G3_READINESS_REVALIDATION.portals.flatMap((portal) =>
    G3_READINESS_REVALIDATION.families.map((family) => ({
      id: `${G3_READINESS_REVALIDATION.id}:${family.id}:${portal}`,
      definitionId: `${G3_READINESS_REVALIDATION.id}:${family.id}`,
      familyId: family.id,
      portal,
      query: family.query,
      requestedTerms: [family.query],
      location,
      channel: "search" as const,
      postedWithinDays: 7 as const,
      sort: "date" as const,
    })),
  );
}
