import { describe, expect, it } from "vitest";
import { evaluateAttentionGate } from "@/lib/intelligence/AttentionGate";

describe("Attention Gate", () => {
  const criteria = {
    targetSeniority: ["Head", "VP"],
    targetRoles: ["Marketing Head"],
    targetLocations: ["Gurugram"],
  };
  const version = (title: string) =>
    ({
      id: "v",
      canonicalJobId: "job",
      contentHash: "h",
      jobTitle: title,
      companyName: "Example",
      location: "Gurugram",
      rawContent: "Own the mandate, build the team and grow the business.",
      acquisitionStatus: "ACQUIRED",
      acquisitionQuality: "COMPLETE",
      lifecycleState: "ACTIVE",
      evidenceState: "SUFFICIENT",
      createdAt: "2026-10-02",
    }) as const;
  it.each(["Head of Marketing", "Chief Demand Architect", "Customer Momentum Steward"])(
    "lets the evaluator resolve indicative-title uncertainty for %s",
    (title) => {
      expect(evaluateAttentionGate(version(title), criteria)).toMatchObject({
        decision: "CANDIDATE",
        eligibility: "REVIEW",
        reasonCodes: ["ROLE_UNKNOWN"],
      });
    },
  );
  it("does not veto a marketing technology mandate because its title contains technology", () => {
    expect(evaluateAttentionGate(version("Marketing Technology Lead"), criteria)).toMatchObject({
      decision: "CANDIDATE",
      eligibility: "REVIEW",
      reasonCodes: ["FUNCTION_REVIEW"],
    });
  });
  it("retains an explicit company exclusion even for a matching title", () => {
    expect(
      evaluateAttentionGate(version("Marketing Head"), {
        ...criteria,
        excludedCompanies: ["Example"],
      }),
    ).toMatchObject({
      decision: "NOT_CANDIDATE",
      eligibility: "INELIGIBLE",
      reasonCodes: ["EXCLUDED_COMPANY"],
    });
  });
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
