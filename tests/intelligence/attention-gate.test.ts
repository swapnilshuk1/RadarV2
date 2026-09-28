import { describe, expect, it } from "vitest";
import { evaluateAttentionGate } from "@/lib/intelligence/AttentionGate";

describe("Attention Gate", () => {
  it("rejects a malformed explicit 1\uFFFD3 year ceiling below the VP target floor", () => {
    const result = evaluateAttentionGate(
      {
        id: "digital-marketing-executive-v1",
        canonicalJobId: "digital-marketing-executive",
        contentHash: "test",
        jobTitle: "Digital Marketing Executive",
        companyName: "Example Co",
        location: "Gurugram",
        employmentType: "FULL_TIME",
        rawContent:
          "Requirements Graduate [1\uFFFD3] years experience in digital marketing (preferred). Are you 0-3 year experienced?",
        acquisitionStatus: "ACQUIRED",
        acquisitionQuality: "COMPLETE",
        lifecycleState: "ACTIVE",
        evidenceState: "SUFFICIENT",
        createdAt: "2026-09-27T00:00:00.000Z",
      },
      { targetSeniority: ["VP"], targetRoles: ["VP Growth"], targetLocations: ["Gurugram"] },
    );

    expect(result).toMatchObject({
      decision: "NOT_CANDIDATE",
      eligibility: "INELIGIBLE",
      reasonCodes: ["SENIORITY_CONTRADICTION"],
    });
  });
});
