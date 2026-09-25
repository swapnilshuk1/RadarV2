import { describe, expect, it } from "vitest";
import { candidateProjectionForContext } from "../../src/lib/intelligence/candidate-evaluation-input";
import type { CandidateProjection } from "../../src/lib/domain/candidate_projection";

const projection: CandidateProjection = {
  operatingLevel: { value: "STRATEGIC", confidence: 1, evidenceIds: ["e1"] },
  workNature: { value: "STRATEGIC_WORK", confidence: 1, evidenceIds: ["e2"] },
  decisionAuthority: { value: "BUSINESS_UNIT", confidence: 1, evidenceIds: ["e3"] },
  commercialScope: { value: "PORTFOLIO", confidence: 1, evidenceIds: ["e4"] },
  yearsOfExperience: 0,
  coreCapabilities: [],
  preferredLocations: [],
  preferredWorkModel: "ANY",
  executiveThemes: [],
};

describe("context-pinned candidate intent composition", () => {
  it("uses immutable search-plan intent without changing attained evidence", () => {
    const contextual = candidateProjectionForContext(projection, {
      targetSeniority: ["VP"],
      targetRoles: ["VP Growth"],
      targetLocations: ["Gurugram", "Bengaluru"],
      preferredWorkModel: "HYBRID",
    });

    expect(contextual.preferredLocations).toEqual(["Gurugram", "Bengaluru"]);
    expect(contextual.preferredWorkModel).toBe("HYBRID");
    expect(contextual.coreCapabilities).toBe(projection.coreCapabilities);
    expect(projection.preferredLocations).toEqual([]);
    expect(projection.preferredWorkModel).toBe("ANY");
  });

  it("preserves legacy projection preferences when an old snapshot lacks new intent fields", () => {
    const legacy = { ...projection, preferredLocations: ["Mumbai"], preferredWorkModel: "REMOTE" as const };
    const contextual = candidateProjectionForContext(legacy, {
      targetSeniority: ["VP"],
      targetRoles: ["VP Growth"],
      targetLocations: [],
    });
    expect(contextual.preferredLocations).toEqual(["Mumbai"]);
    expect(contextual.preferredWorkModel).toBe("REMOTE");
  });
});
