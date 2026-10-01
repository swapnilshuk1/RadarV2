import { describe, expect, it } from "vitest";

import { evaluateAttentionGate } from "@/lib/intelligence/AttentionGate";
import { CandidateSeniorityClassifier } from "@/lib/intelligence/classifiers/CandidateSeniorityClassifier";
import { OperatingLevelClassifier } from "@/lib/intelligence/classifiers/OperatingLevelClassifier";
import { SeniorityResolver } from "@/lib/intelligence/semantic/resolvers/SeniorityResolver";

function opportunity(title: string, rawContent = ""): any {
  return {
    id: `opp-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    canonicalJobId: "canonical-1",
    contentHash: "test",
    jobTitle: title,
    companyName: "Example Co",
    location: "Gurugram",
    employmentType: "FULL_TIME",
    rawContent,
    acquisitionStatus: "ACQUIRED",
    acquisitionQuality: "COMPLETE",
    lifecycleState: "ACTIVE",
    evidenceState: "SUFFICIENT",
    createdAt: "2026-10-01T00:00:00.000Z",
  };
}

const vpMarketingCriteria: any = {
  targetSeniority: ["VP"],
  targetRoles: ["Marketing"],
  targetLocations: ["Gurugram"],
};

describe("seniority and career-intent integrity", () => {
  it.each([
    ["Marketing Executive", "INDIVIDUAL_CONTRIBUTOR"],
    ["Senior Marketing Executive", "INDIVIDUAL_CONTRIBUTOR"],
    ["Growth Creative Strategist", "INDIVIDUAL_CONTRIBUTOR"],
    ["CRM Specialist", "INDIVIDUAL_CONTRIBUTOR"],
    ["Marketing Manager", "MANAGER"],
    ["Marketing Lead", "LEAD"],
  ])("resolves %s below executive bands", (title, expected) => {
    expect(SeniorityResolver.resolve(title).seniorityBand).toBe(expected);
  });

  it("does not inflate regional AVP or General Manager titles", () => {
    expect(SeniorityResolver.resolve("AVP Marketing").seniorityBand).toBe("DIRECTOR");
    expect(SeniorityResolver.resolve("General Manager Marketing").seniorityBand).toBe("MANAGER");
  });

  it("rejects a high-confidence multi-band junior title before evaluation", () => {
    expect(evaluateAttentionGate(opportunity("Marketing Executive"), vpMarketingCriteria)).toMatchObject({
      decision: "NOT_CANDIDATE",
      eligibility: "INELIGIBLE",
      reasonCodes: ["SENIORITY_CONTRADICTION"],
    });
  });

  it("routes a one-band-below title to review rather than shortlist evaluation", () => {
    expect(evaluateAttentionGate(opportunity("Marketing Director"), vpMarketingCriteria)).toMatchObject({
      decision: "CANDIDATE",
      eligibility: "REVIEW",
      reasonCodes: ["SENIORITY_REVIEW"],
    });
  });

  it("routes ambiguous seniority to review", () => {
    expect(evaluateAttentionGate(opportunity("Growth Ninja"), {
      ...vpMarketingCriteria,
      targetRoles: ["Growth"],
    })).toMatchObject({
      decision: "CANDIDATE",
      eligibility: "REVIEW",
    });
  });

  it("keeps candidate manager titles out of the director band", () => {
    expect(CandidateSeniorityClassifier.classify("Marketing Manager", "").value).toBe("UNKNOWN");
    expect(CandidateSeniorityClassifier.classify("AVP Marketing", "").value).toBe("DIRECTOR");
  });

  it("treats Associate Director as strategic rather than executive operating level", () => {
    expect(
      OperatingLevelClassifier.classify(
        "Own regional marketing strategy and cross-functional planning.",
        "Associate Director Marketing",
      ).value,
    ).toBe("STRATEGIC");
  });
});
