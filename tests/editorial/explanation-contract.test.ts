import { describe, it, expect } from "vitest";
import type { Opportunity } from "../../src/data/opportunity-fixtures";
import { EditorialContextBuilder } from "../../src/lib/intelligence/editorial/EditorialContext";
import { PrimaryReasonResolver } from "../../src/lib/intelligence/editorial/PrimaryReasonResolver";
import { ExecutiveThesisBuilder } from "../../src/lib/intelligence/editorial/ExecutiveThesisBuilder";
import { BriefCompositionEngine } from "../../src/lib/intelligence/editorial/BriefCompositionEngine";

function createFixture(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp_test_p1_2",
    jobHash: "hash_p1_2_test",
    role: "Chief Commercial Officer",
    company: "Acme Enterprise",
    location: "Bengaluru",
    engineRecommendation: {
      engineVerdict: "CONSIDER",
      qualityScore: 78,
      triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
      trajectoryUpside: "LIMITED",
      relativeDifferentiator: "P&L Scale vs Operating Velocity",
    },
    dimensions: [
      { key: "functionalScope", label: "GTM Leadership", jdEvidence: { status: "Explicit", value: "GTM Leadership", evidence: [{ quote: "GTM Leadership", source: "snippet" }] } },
      { key: "mandate", label: "Commercial Transformation", jdEvidence: { status: "Explicit", value: "Commercial Transformation", evidence: [{ quote: "Commercial Transformation", source: "snippet" }] } },
    ],
    ...overrides,
  } as Opportunity;
}

describe("RADAR V4 Phase P1.2 — Executive Decision Explanation Integrity Suite (Cases A–Q)", () => {
  // Case A: Strong Pursue
  it("Case A — Strong Pursue: verdict PURSUE, high career upside, actionable recommendation", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 92,
        triggeredRuleIds: ["R-PURSUE-HIGH-ALIGNMENT"],
        trajectoryUpside: "HIGH",
        relativeDifferentiator: "Substantial P&L Step-up",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.verdict).toBe("PURSUE");
    expect(exp.careerValueSignal).toBe("HIGH CAREER UPSIDE");
    expect(exp.recommendedAction).toMatch(/APPLY|TAILOR_AND_APPLY/);
    expect(exp.bottomLine).toContain("Acme Enterprise");
    expect(exp.provenance.some((p) => p.source === "DECISION_POLICY")).toBe(true);
  });

  // Case B: Limited Upside
  it("Case B — Limited Upside: verdict CONSIDER + limited upside warning explicitly preserved", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 75,
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        trajectoryUpside: "LIMITED",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.verdict).toBe("CONSIDER");
    expect(exp.careerValueSignal).toBe("LIMITED CAREER UPSIDE");
    expect(exp.bottomLine).toContain("limited incremental career upside");
  });

  // Case C: Material Regression
  it("Case C — Material Regression: verdict CONSIDER + career regression warning preserved", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 68,
        triggeredRuleIds: ["R-CONSIDER-CAREER-REGRESSION"],
        trajectoryUpside: "REGRESSION",
        careerValueProtection: "DOWNSCALED",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.verdict).toBe("CONSIDER");
    expect(exp.careerValueSignal).toBe("CAREER REGRESSION / PROTECTION");
    expect(exp.recommendedAction).toBe("REASSESS_SCOPE");
    expect(exp.primaryReason).toContain("career regression");
  });

  // Case D: PASS Despite High Capability
  it("Case D — PASS Despite High Capability: PASS verdict cannot be converted into positive language", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "PASS",
        qualityScore: 88, // High capability score
        triggeredRuleIds: ["R-PASS-IDENTITY-MISMATCH"],
        trajectoryUpside: "LIMITED",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.verdict).toBe("PASS");
    expect(exp.recommendedAction).toBe("PASS");
    expect(exp.bottomLine).not.toMatch(/Strong opportunity|Excellent fit/i);
    expect(exp.primaryReason).toContain("Strategic pass");
  });

  // Case E: User Override
  it("Case E — User Override: engine CONSIDER + user PURSUE -> explanation verdict remains CONSIDER", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 70,
        triggeredRuleIds: [],
        trajectoryUpside: "LIMITED",
      },
      userDecision: "PURSUE",
    } as any);
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.verdict).toBe("CONSIDER");
    expect(exp.headline).not.toContain("PURSUE:");
  });

  // Case F: Stale User Decision
  it("Case F — Stale User Decision: stale status does not affect explanation verdict or rationale", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 72,
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        trajectoryUpside: "LIMITED",
      },
      userDecisionState: "STALE",
    } as any);
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.verdict).toBe("CONSIDER");
    expect(exp.careerValueSignal).toBe("LIMITED CAREER UPSIDE");
  });

  // Case G: Missing Engine Verdict
  it("Case G — Missing Engine Verdict: null verdict produces fail-closed null explanation verdict", () => {
    const opp = createFixture({
      engineRecommendation: undefined,
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.verdict).toBeNull();
    expect(exp.headline).toContain("RECOMMENDATION UNAVAILABLE");
  });

  // Case H: Missing Career Signal
  it("Case H — Missing Career Signal: null career signal remains null without fabrication", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 65,
        triggeredRuleIds: [],
        trajectoryUpside: null,
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.careerValueSignal).toBeNull();
  });

  // Case I: High Capability + Low Career Value
  it("Case I — High Capability + Low Career Value: capability fit does not suppress limited career upside", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 90, // High capability score
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        trajectoryUpside: "LIMITED",
        relativeDifferentiator: "Horizontal Transfer",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.verdict).toBe("CONSIDER");
    expect(exp.careerValueSignal).toBe("LIMITED CAREER UPSIDE");
    expect(exp.bottomLine).toContain("limited incremental career upside");
  });

  // Case J: Strong Career Value + Moderate Capability
  it("Case J — Strong Career Value + Moderate Capability: career upside does not become capability certainty", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 62,
        triggeredRuleIds: [],
        trajectoryUpside: "HIGH",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.verdict).toBe("CONSIDER");
    expect(exp.careerValueSignal).toBe("HIGH CAREER UPSIDE");
    expect(exp.evidenceStrength).not.toBe("STRONG");
  });

  // Case K: Sparse JD
  it("Case K — Sparse JD: insufficient specification communicated with LIMITED evidence strength", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 55,
        triggeredRuleIds: [],
        trajectoryUpside: null,
      },
      dimensions: [], // Zero explicit evidence
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.evidenceStrength).toBe("LIMITED");
    expect(exp.recommendedAction).toBe("INVESTIGATE");
  });

  // Case L: Strong Evidence
  it("Case L — Strong Evidence: explicitCount >= 3 produces STRONG evidence strength", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 95,
        triggeredRuleIds: [],
        trajectoryUpside: "HIGH",
      },
      dimensions: [
        { key: "functionalScope", label: "Commercial Governance", jdEvidence: { status: "Explicit" } },
        { key: "mandate", label: "GTM Expansion", jdEvidence: { status: "Explicit" } },
        { key: "technologyStack", label: "Enterprise CRM", jdEvidence: { status: "Explicit" } },
      ],
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.evidenceStrength).toBe("STRONG");
    expect(exp.recommendedAction).toBe("APPLY");
  });

  // Case M: Weak Evidence
  it("Case M — Weak Evidence: evidence strength is distinct from capability fit", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 85, // High quality score
        triggeredRuleIds: [],
        trajectoryUpside: "LIMITED",
      },
      dimensions: [], // Zero explicit JD evidence
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.evidenceStrength).toBe("LIMITED");
    expect(exp.recommendedAction).toBe("INVESTIGATE");
  });

  // Case N: Conflicting Signals
  it("Case N — Conflicting Signals: veto rule takes priority in rationale hierarchy", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 82,
        triggeredRuleIds: ["G-SUB-TIER-MANDATE-VETO"],
        trajectoryUpside: "HIGH",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.careerValueSignal).toBe("SUB-TIER MANDATE");
    expect(exp.primaryReason).toContain("Sub-tier mandate warning");
  });

  // Case O: Surface Convergence
  it("Case O — Surface Convergence: BriefModel exposes identical explanation object across surfaces", () => {
    const opp = createFixture();
    const brief = BriefCompositionEngine.compose(opp);

    expect(brief.explanation).toBeDefined();
    expect(brief.explanation.verdict).toBe(brief.editorialContext.engineVerdict);
    expect(brief.executiveThesis.explanation).toBe(brief.explanation);
  });

  // Case P: Score Mutation
  it("Case P — Score Mutation: changing qualityScore after generation does not alter explanation", () => {
    const opp = createFixture();
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    // Mutate opp recommendation score
    opp.engineRecommendation!.qualityScore = 99;

    expect(exp.verdict).toBe("CONSIDER");
    expect(exp.recommendedAction).not.toBe("APPLY");
  });

  // Case Q: User Decision Mutation
  it("Case Q — User Decision Mutation: changing user decision from PURSUE to PASS does not alter engine explanation", () => {
    const opp = createFixture({
      userDecision: "PURSUE",
    } as any);
    const ctx = EditorialContextBuilder.build(opp);
    const expBefore = PrimaryReasonResolver.resolve(ctx, opp);

    (opp as any).userDecision = "PASS";
    const ctxAfter = EditorialContextBuilder.build(opp);
    const expAfter = PrimaryReasonResolver.resolve(ctxAfter, opp);

    expect(expBefore.verdict).toBe(expAfter.verdict);
    expect(expBefore.primaryReason).toBe(expAfter.primaryReason);
  });

  // Case R: G-COMPATIBILITY-REGRESSION-VETO Explanation Differentiation
  it("Case R — G-COMPATIBILITY-REGRESSION-VETO: frames PASS as career trajectory regression (not altitude/scoping mismatch)", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "PASS",
        qualityScore: 72,
        triggeredRuleIds: ["G-COMPATIBILITY-REGRESSION-VETO"],
        trajectoryUpside: "REGRESSION",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.verdict).toBe("PASS");
    expect(exp.primaryReason).toContain("Career trajectory regression");
    expect(exp.primaryReason).not.toContain("Operating altitude or role scoping");
  });

  // Case S: POL-D-PASS-PROHIBITIVE-FRICTION Semantic Distinction Test
  it("Case S — POL-D-PASS-PROHIBITIVE-FRICTION: preserves distinction (Quality OK, passed due to prohibitive pursuit constraints)", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "PASS",
        qualityScore: 85, // High quality / fit
        triggeredRuleIds: ["POL-D-PASS-PROHIBITIVE-FRICTION"],
        trajectoryUpside: "HIGH",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    expect(exp.verdict).toBe("PASS");
    expect(exp.primaryReason).toContain("Prohibitive pursuit friction");
    expect(exp.primaryReason).toContain("This is not a quality or capability rejection");
    expect(exp.primaryReason).not.toContain("operating altitude");
    expect(exp.primaryReason).not.toContain("role scoping");
    expect(exp.primaryReason).not.toContain("executive baseline");
  });

  // Case T: Fail-Closed PASS Rule Mapping Certification Invariant
  it("Case T — Fail-Closed Certification Invariant: every PASS rule ID emitted by DecisionPolicyEngine has an explicit mapping", () => {
    const passRuleIds = [
      "G-EVIDENCE-GATE-SPARSE-SPEC",
      "G-EXECUTIVE-IDENTITY-MISMATCH",
      "G-EVIDENCE-INTEGRITY-FAILED",
      "G-SUB-TIER-MANDATE-VETO",
      "G-IDENTITY-VETO",
      "G-EXECUTION-VETO",
      "G-COMPATIBILITY-REGRESSION-VETO",
      "POL-D-PASS-PROHIBITIVE-FRICTION",
      "R-PASS-LOW-PRIORITY",
    ];

    const genericFallbackPrefix = "Strategic pass: Operating altitude or role scoping";

    for (const ruleId of passRuleIds) {
      const opp = createFixture({
        engineRecommendation: {
          engineVerdict: "PASS",
          qualityScore: 60,
          triggeredRuleIds: [ruleId],
        },
      });
      const ctx = EditorialContextBuilder.build(opp);
      const exp = PrimaryReasonResolver.resolve(ctx, opp);

      expect(exp.verdict).toBe("PASS");
      expect(
        exp.primaryReason.startsWith(genericFallbackPrefix),
        `PASS rule ID [${ruleId}] fell through to unmapped generic fallback! Every PASS rule must have an explicit mapping.`
      ).toBe(false);
    }
  });
});
