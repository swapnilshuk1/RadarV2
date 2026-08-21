import { describe, it, expect } from "vitest";
import { PrimaryReasonResolver } from "../../src/lib/intelligence/editorial/PrimaryReasonResolver";
import type { EditorialContext } from "../../src/lib/intelligence/editorial/EditorialContext";

describe("Phase 6 — PASS & CONSIDER Explanation Coverage", () => {
  const createMockContext = (
    engineVerdict: "PURSUE" | "CONSIDER" | "PASS" | null,
    triggeredRuleIds: string[] = []
  ): EditorialContext => ({
    opportunityId: "opp-exp-coverage",
    engineVerdict,
    qualityScore: 70,
    confidence: "HIGH",
    rawScore: 70,
    certaintyPct: 85,
    isFounderLed: false,
    isPE: false,
    isPublic: true,
    careerValue: {
      trajectoryUpside: "LATERAL",
      careerRegressionScore: 10,
      careerValueProtection: null,
      relativeDifferentiator: "Scale Transformation",
      triggeredRuleIds
    },
    identity: {
      coverage: 0.9,
      distance: 0.1,
      verdict: "MATCH"
    },
    capability: {
      overallFit: 0.8,
      matchedCapabilities: ["GTM", "P&L"],
      missingCapabilities: []
    },
    lifestyle: {
      locationFrictionPenalty: 0
    },
    evidence: {
      explicitCount: 4,
      evidenceQuality: "High Evidence Quality"
    }
  });

  it("Generates specific explanation for POL-D-CONSIDER-REACH-ROLE", () => {
    const ctx = createMockContext("CONSIDER", ["POL-D-CONSIDER-REACH-ROLE"]);
    const res = PrimaryReasonResolver.resolve(ctx);

    expect(res.verdict).toBe("CONSIDER");
    expect(res.primaryReason.toLowerCase()).toContain("reach");
    expect(res.provenance.some(p => p.ruleIds?.includes("POL-D-CONSIDER-REACH-ROLE"))).toBe(true);
  });

  it("Generates specific explanation for POL-D-CONSIDER-HIGH-FRICTION", () => {
    const ctx = createMockContext("CONSIDER", ["POL-D-CONSIDER-HIGH-FRICTION"]);
    const res = PrimaryReasonResolver.resolve(ctx);

    expect(res.verdict).toBe("CONSIDER");
    expect(res.primaryReason.toLowerCase()).toContain("friction");
    expect(res.provenance.some(p => p.ruleIds?.includes("POL-D-CONSIDER-HIGH-FRICTION"))).toBe(true);
  });

  it("Generates specific explanation for POL-D-PASS-PROHIBITIVE-FRICTION", () => {
    const ctx = createMockContext("PASS", ["POL-D-PASS-PROHIBITIVE-FRICTION"]);
    const res = PrimaryReasonResolver.resolve(ctx);

    expect(res.verdict).toBe("PASS");
    expect(res.primaryReason.toLowerCase()).toContain("friction");
  });

  it("Generates specific explanation for G-COMPATIBILITY-REGRESSION-VETO", () => {
    const ctx = createMockContext("PASS", ["G-COMPATIBILITY-REGRESSION-VETO"]);
    const res = PrimaryReasonResolver.resolve(ctx);

    expect(res.verdict).toBe("PASS");
    expect(res.primaryReason.toLowerCase()).toContain("regression");
  });

  it("Generates specific explanation for G-EXECUTIVE-IDENTITY-MISMATCH", () => {
    const ctx = createMockContext("PASS", ["G-EXECUTIVE-IDENTITY-MISMATCH"]);
    const res = PrimaryReasonResolver.resolve(ctx);

    expect(res.verdict).toBe("PASS");
    expect(res.primaryReason.toLowerCase()).toContain("mismatch");
  });
});
