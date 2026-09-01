import { describe, it, expect } from "vitest";
import { BriefCompositionEngine } from "../../src/lib/intelligence/editorial/BriefCompositionEngine";
import type { Opportunity } from "../../src/domain/entities";

describe("Phase 3 — Editorial Hydration & Single Recommendation Source of Truth", () => {
  it("Unevaluated opportunity with null engineVerdict does NOT synthesize an actionable CONSIDER decision", () => {
    const rawOpp: Opportunity = {
      id: "opp-unevaluated",
      canonicalTitle: "Director of Marketing",
      companyId: "comp-1",
      companyName: "Acme Corp",
      location: "Bengaluru",
      description: "Brief marketing role description",
      dimensions: [],
      matchScore: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const brief = BriefCompositionEngine.compose(rawOpp);

    // Decision in brief memory must NOT be an actionable "CONSIDER" or "PURSUE"
    expect(brief.memory.decision).not.toBe("CONSIDER");
    expect(brief.memory.decision).not.toBe("PURSUE");
  });

  it("Opportunity with explicit policyResult retains canonical verdict and does not override it", () => {
    const passOpp: Opportunity = {
      id: "opp-pass",
      canonicalTitle: "VP Sales",
      companyId: "comp-2",
      companyName: "Pass Corp",
      location: "London",
      description: "VP Sales enterprise expansion role with published responsibilities for enterprise account strategy, revenue planning, customer retention, sales leadership, territory execution, pipeline governance, and cross-functional coordination. The recruiter will confirm the final reporting line, team scope, and approved commercial resources during screening.",
      dimensions: [],
      policyResult: {
        verdict: "PASS",
        evaluationStatus: "COMPLETE",
        recommendation: "PASS",
        qualityScore: 50,
        rawScore: 50,
        priorityScore: 50,
        vetoed: false,
        vetoReason: null,
        claimPermissions: { canClaimScope: true, canClaimScale: true, canClaimLevel: true },
        structuralConviction: false,
        uiLabel: "Pass",
        confidences: { parsing: 0.9, matching: 0.9, recommendation: 0.9 },
        tailoringEffort: "LOW",
        trajectoryUpside: "Moderate",
        relativeDifferentiator: "Prohibitive location friction",
        triggeredRuleIds: ["POL-D-PASS-PROHIBITIVE-FRICTION"],
        pipeline: [],
        decisionDrivers: [],
        decisionRisks: []
      },
      matchScore: 50,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const brief = BriefCompositionEngine.compose(passOpp);

    expect(brief.memory.decision).toBe("PASS");
  });
});
