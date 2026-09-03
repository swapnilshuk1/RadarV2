import type { AcquisitionVariant, PortalName } from "../types";

/**
 * Immutable, deliberately small G2 validation surface. It is separate from
 * the tenant's active search plan and must only be executed through an
 * explicitly authorized controlled-validation launch path.
 */
export const G2_CONTROLLED_COHORT = {
  id: "g2-controlled-acquisition-v1",
  maxPages: 1,
  maxCardsPerUnit: 10,
  portals: ["LinkedIn", "Naukri", "Indeed"] as const satisfies readonly PortalName[],
  families: [
    { id: "vp-client-services", label: "VP client services", query: "VP Client Services" },
    { id: "vp-client-experience", label: "VP client experience / digital", query: "VP Client Experience" },
    { id: "chief-transformation", label: "Chief strategy / transformation", query: "Chief Transformation Officer" },
    { id: "vp-growth-marketing", label: "VP growth / marketing", query: "VP Growth" },
    { id: "vp-engineering-control", label: "VP engineering hard-exclusion control", query: "VP Engineering" },
  ],
} as const;

export function compileG2ControlledCohort(location?: string): AcquisitionVariant[] {
  return G2_CONTROLLED_COHORT.portals.flatMap((portal) =>
    G2_CONTROLLED_COHORT.families.map((family) => ({
      id: `${G2_CONTROLLED_COHORT.id}:${family.id}:${portal}`,
      definitionId: `${G2_CONTROLLED_COHORT.id}:${family.id}`,
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
