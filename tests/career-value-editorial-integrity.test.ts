import { describe, it, expect } from "vitest";
import { EditorialContextBuilder } from "../src/lib/intelligence/editorial/EditorialContext";
import { ExecutiveThesisBuilder } from "../src/lib/intelligence/editorial/ExecutiveThesisBuilder";
import { BriefCompositionEngine } from "../src/lib/intelligence/editorial/BriefCompositionEngine";
import type { Opportunity } from "../src/data/opportunity-fixtures";

function createMockOpportunity(overrides?: Partial<Opportunity>): Opportunity {
  return {
    jobHash: "mock_job_123",
    role: "VP Growth & Marketing",
    company: "SkanAI Solutions",
    location: "Bengaluru, KA",
    scrapedFrom: "LinkedIn",
    scrapedAt: new Date().toISOString(),
    engineRecommendation: {
      jobHash: "mock_job_123",
      evaluationFingerprint: "v4.1:mock_job_123:CONSIDER",
      engineVerdict: "CONSIDER",
      vetoed: false,
      vetoReason: null,
      qualityScore: 78,
      parsingConfidence: 0.9,
      evaluatedAt: new Date().toISOString(),
      triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
      decisionRisks: ["Scope limitation"],
      decisionDrivers: ["Domain alignment"],
      relativeDifferentiator: "High interview probability but limited career step-up.",
      trajectoryUpside: "LIMITED",
      careerRegressionScore: 65,
      careerValueProtection: "DOWNSCALED",
    } as any,
    decision: "CONSIDER",
    ...overrides,
  } as Opportunity;
}

describe("RADAR V4 — Career-Value Editorial Integrity Suite (Cases A–O)", () => {
  it("Case A — High Upside: PURSUE + HIGH upside propagates intact", () => {
    const opp = createMockOpportunity({
      engineRecommendation: {
        jobHash: "mock_a",
        evaluationFingerprint: "v4.1:mock_a:PURSUE",
        engineVerdict: "PURSUE",
        vetoed: false,
        vetoReason: null,
        qualityScore: 92,
        parsingConfidence: 0.95,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-PURSUE-HIGH-SCALE"],
        decisionRisks: [],
        decisionDrivers: ["P&L Scale"],
        relativeDifferentiator: "Massive commercial expansion upside.",
        trajectoryUpside: "HIGH",
        careerRegressionScore: 10,
        careerValueProtection: "CLEAR",
      } as any,
      decision: "PURSUE",
    });

    const ctx = EditorialContextBuilder.build(opp);
    const thesis = ExecutiveThesisBuilder.build(ctx, opp);
    const brief = BriefCompositionEngine.compose(opp);

    expect(ctx.engineVerdict).toBe("PURSUE");
    expect(thesis.verdict).toBe("PURSUE");
    expect(thesis.careerValueSignal).toBe("HIGH CAREER UPSIDE");
    expect(brief.executiveThesis.verdict).toBe("PURSUE");
    expect(brief.executiveThesis.careerValueSignal).toBe("HIGH CAREER UPSIDE");
  });

  it("Case B — Limited Upside: CONSIDER + LIMITED upside preserves warning", () => {
    const opp = createMockOpportunity({
      engineRecommendation: {
        jobHash: "mock_b",
        evaluationFingerprint: "v4.1:mock_b:CONSIDER",
        engineVerdict: "CONSIDER",
        vetoed: false,
        vetoReason: null,
        qualityScore: 82,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        decisionRisks: ["Limited career step-up"],
        decisionDrivers: ["Profile match"],
        relativeDifferentiator: "High profile match but limited career upside.",
        trajectoryUpside: "LIMITED",
        careerRegressionScore: 45,
        careerValueProtection: "CLEAR",
      } as any,
      decision: "CONSIDER",
    });

    const ctx = EditorialContextBuilder.build(opp);
    const thesis = ExecutiveThesisBuilder.build(ctx, opp);

    expect(thesis.verdict).toBe("CONSIDER");
    expect(thesis.careerValueSignal).toBe("LIMITED CAREER UPSIDE");
    expect(thesis.primaryReason).toContain("limited incremental career upside");
  });

  it("Case C — Material Regression: CONSIDER + DOWNSCALED preserves material regression warning", () => {
    const opp = createMockOpportunity({
      engineRecommendation: {
        jobHash: "mock_c",
        evaluationFingerprint: "v4.1:mock_c:CONSIDER",
        engineVerdict: "CONSIDER",
        vetoed: false,
        vetoReason: null,
        qualityScore: 75,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        decisionRisks: ["Scope regression"],
        decisionDrivers: ["Functional match"],
        relativeDifferentiator: "Lateral or regressive move.",
        trajectoryUpside: "REGRESSION",
        careerRegressionScore: 70,
        careerValueProtection: "DOWNSCALED",
      } as any,
      decision: "CONSIDER",
    });

    const ctx = EditorialContextBuilder.build(opp);
    const thesis = ExecutiveThesisBuilder.build(ctx, opp);

    expect(thesis.verdict).toBe("CONSIDER");
    expect(thesis.careerValueSignal).toBe("CAREER REGRESSION / PROTECTION");
  });

  it("Case D — High Capability + Regression: High capability score does NOT erase career regression warning", () => {
    const opp = createMockOpportunity({
      engineRecommendation: {
        jobHash: "mock_d",
        evaluationFingerprint: "v4.1:mock_d:CONSIDER",
        engineVerdict: "CONSIDER",
        vetoed: false,
        vetoReason: null,
        qualityScore: 95, // High raw capability match
        parsingConfidence: 0.95,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        decisionRisks: ["Material regression"],
        decisionDrivers: ["100% domain overlap"],
        relativeDifferentiator: "Highly accessible move but regressive scale.",
        trajectoryUpside: "LIMITED",
        careerRegressionScore: 68,
        careerValueProtection: "DOWNSCALED",
        capabilityFit: { overallFit: 98, matchedCapabilities: ["Growth", "GTM"], missingCapabilities: [] },
      } as any,
      decision: "CONSIDER",
    });

    const ctx = EditorialContextBuilder.build(opp);
    const thesis = ExecutiveThesisBuilder.build(ctx, opp);

    expect(thesis.verdict).toBe("CONSIDER"); // Not promoted to PURSUE!
    expect(thesis.careerValueSignal).toBe("CAREER REGRESSION / PROTECTION");
  });

  it("Case E — User Override: User choosing PURSUE does NOT flip RADAR executive thesis to PURSUE", () => {
    const opp = createMockOpportunity({
      engineRecommendation: {
        jobHash: "mock_e",
        evaluationFingerprint: "v4.1:mock_e:CONSIDER",
        engineVerdict: "CONSIDER",
        vetoed: false,
        vetoReason: null,
        qualityScore: 70,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        decisionRisks: [],
        decisionDrivers: [],
        relativeDifferentiator: null,
        trajectoryUpside: "LIMITED",
      } as any,
      userDecision: {
        personId: "user1",
        jobHash: "mock_e",
        userAction: "PURSUE", // User explicitly chose PURSUE
        reviewedFingerprint: "v4.1:mock_e:CONSIDER",
        updatedAt: new Date().toISOString(),
      } as any,
      decision: "PURSUE", // User choice
    });

    const ctx = EditorialContextBuilder.build(opp);
    const thesis = ExecutiveThesisBuilder.build(ctx, opp);

    expect(ctx.engineVerdict).toBe("CONSIDER");
    expect(thesis.verdict).toBe("CONSIDER"); // Must remain CONSIDER!
  });

  it("Case F — PASS Despite High Capability: PASS cannot be editorially promoted to positive recommendation", () => {
    const opp = createMockOpportunity({
      engineRecommendation: {
        jobHash: "mock_f",
        evaluationFingerprint: "v4.1:mock_f:PASS",
        engineVerdict: "PASS",
        vetoed: true,
        vetoReason: "G-SUB-TIER-MANDATE-VETO",
        qualityScore: 85,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["G-SUB-TIER-MANDATE-VETO"],
        decisionRisks: ["Sub-tier mandate"],
        decisionDrivers: [],
        relativeDifferentiator: null,
        trajectoryUpside: "REGRESSION",
      } as any,
      decision: "PASS",
    });

    const ctx = EditorialContextBuilder.build(opp);
    const thesis = ExecutiveThesisBuilder.build(ctx, opp);

    expect(ctx.engineVerdict).toBe("PASS");
    expect(thesis.verdict).toBe("PASS");
    expect(thesis.careerValueSignal).toBe("SUB-TIER MANDATE");
    expect(thesis.primaryReason).toContain("Strategic pass");
  });

  it("Case G — Missing Career Signal: Null career values do not fabricate upside", () => {
    const opp = createMockOpportunity({
      engineRecommendation: {
        jobHash: "mock_g",
        evaluationFingerprint: "v4.1:mock_g:CONSIDER",
        engineVerdict: "CONSIDER",
        vetoed: false,
        vetoReason: null,
        qualityScore: 60,
        parsingConfidence: 0.8,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: [],
        decisionRisks: [],
        decisionDrivers: [],
        relativeDifferentiator: null,
        trajectoryUpside: null,
        careerRegressionScore: null,
        careerValueProtection: null,
      } as any,
      decision: "CONSIDER",
    });

    const ctx = EditorialContextBuilder.build(opp);
    const thesis = ExecutiveThesisBuilder.build(ctx, opp);

    expect(thesis.careerValueSignal).toBeNull();
  });

  it("Case H — Missing Engine Verdict: Null engine verdict produces null thesis verdict (RECOMMENDATION UNAVAILABLE)", () => {
    const opp = createMockOpportunity({
      engineRecommendation: undefined,
      decision: undefined as any,
    });

    const ctx = EditorialContextBuilder.build(opp);
    const thesis = ExecutiveThesisBuilder.build(ctx, opp);

    expect(ctx.engineVerdict).toBeNull();
    expect(thesis.verdict).toBeNull();
    expect(thesis.headline).toContain("RECOMMENDATION UNAVAILABLE");
  });

  it("Case I — Quality Score Mutation: Changing qualityScore leaves thesis verdict unchanged", () => {
    const baseOpp = createMockOpportunity();

    [20, 50, 75, 95].forEach((score) => {
      const opp = {
        ...baseOpp,
        engineRecommendation: {
          ...baseOpp.engineRecommendation!,
          qualityScore: score,
        },
      };

      const ctx = EditorialContextBuilder.build(opp);
      const thesis = ExecutiveThesisBuilder.build(ctx, opp);

      expect(thesis.verdict).toBe("CONSIDER");
      expect(thesis.careerValueSignal).toBe("CAREER REGRESSION / PROTECTION");
    });
  });

  it("Case J — Surface Convergence: All surfaces consume the same canonical thesis", () => {
    const opp = createMockOpportunity();
    const brief = BriefCompositionEngine.compose(opp);

    expect(brief.editorialContext.engineVerdict).toBe("CONSIDER");
    expect(brief.executiveThesis.verdict).toBe("CONSIDER");
    expect(brief.structuredSections.synthesis.thesis).toBe(brief.executiveThesis.primaryReason);
    expect(brief.memory.headline).toBe(brief.executiveThesis.headline);
  });

  it("Case K — Score Threshold Trap: Changing careerRegressionScore 49 -> 51 without rule change leaves thesis unchanged", () => {
    const opp49 = createMockOpportunity({
      engineRecommendation: {
        jobHash: "mock_k",
        evaluationFingerprint: "v4.1:mock_k:CONSIDER",
        engineVerdict: "CONSIDER",
        vetoed: false,
        vetoReason: null,
        qualityScore: 70,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        trajectoryUpside: "LIMITED",
        careerRegressionScore: 49, // Score 49
        careerValueProtection: "CLEAR",
      } as any,
    });

    const opp51 = createMockOpportunity({
      engineRecommendation: {
        jobHash: "mock_k",
        evaluationFingerprint: "v4.1:mock_k:CONSIDER",
        engineVerdict: "CONSIDER",
        vetoed: false,
        vetoReason: null,
        qualityScore: 70,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        trajectoryUpside: "LIMITED",
        careerRegressionScore: 51, // Score 51
        careerValueProtection: "CLEAR",
      } as any,
    });

    const thesis49 = ExecutiveThesisBuilder.build(EditorialContextBuilder.build(opp49), opp49);
    const thesis51 = ExecutiveThesisBuilder.build(EditorialContextBuilder.build(opp51), opp51);

    expect(thesis49.careerValueSignal).toBe("LIMITED CAREER UPSIDE");
    expect(thesis51.careerValueSignal).toBe("LIMITED CAREER UPSIDE");
    expect(thesis49.primaryReason).toBe(thesis51.primaryReason);
  });

  it("Case L — User Decision Mutation: Mutating userDecision keeps ExecutiveThesis identical", () => {
    const baseOpp = createMockOpportunity();
    const initialThesis = ExecutiveThesisBuilder.build(EditorialContextBuilder.build(baseOpp), baseOpp);

    [null, "PURSUE", "CONSIDER", "PASS"].forEach((action) => {
      const opp = {
        ...baseOpp,
        userDecision: action ? { userAction: action } : null,
      } as any;

      const thesis = ExecutiveThesisBuilder.build(EditorialContextBuilder.build(opp), opp);
      expect(thesis.verdict).toBe(initialThesis.verdict);
      expect(thesis.careerValueSignal).toBe(initialThesis.careerValueSignal);
      expect(thesis.primaryReason).toBe(initialThesis.primaryReason);
    });
  });

  it("Case M — Capability Mutation: Changing capability score dramatically leaves thesis unchanged", () => {
    const baseOpp = createMockOpportunity();
    const initialThesis = ExecutiveThesisBuilder.build(EditorialContextBuilder.build(baseOpp), baseOpp);

    [10, 50, 99].forEach((capScore) => {
      const opp = {
        ...baseOpp,
        engineRecommendation: {
          ...baseOpp.engineRecommendation!,
          capabilityFit: { overallFit: capScore },
        },
      } as any;

      const thesis = ExecutiveThesisBuilder.build(EditorialContextBuilder.build(opp), opp);
      expect(thesis.verdict).toBe(initialThesis.verdict);
      expect(thesis.careerValueSignal).toBe(initialThesis.careerValueSignal);
    });
  });

  it("Case N — Missing Optional Fields: Missing trajectoryUpside/triggeredRuleIds does not crash or fabricate", () => {
    const opp = createMockOpportunity({
      engineRecommendation: {
        jobHash: "mock_n",
        evaluationFingerprint: "v4.1:mock_n:PURSUE",
        engineVerdict: "PURSUE",
        vetoed: false,
        vetoReason: null,
        qualityScore: 88,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
      } as any,
    });

    const ctx = EditorialContextBuilder.build(opp);
    const thesis = ExecutiveThesisBuilder.build(ctx, opp);

    expect(ctx.engineVerdict).toBe("PURSUE");
    expect(thesis.verdict).toBe("PURSUE");
    expect(thesis.careerValueSignal).toBeNull();
  });

  it("Case O — Surface Divergence: Supplying conflicting raw score inputs does not cause surface divergence", () => {
    const opp = createMockOpportunity();
    const brief = BriefCompositionEngine.compose(opp);

    const surfaceHeroVerdict = brief.executiveThesis.verdict;
    const surfaceSummaryVerdict = brief.executiveThesis.verdict;
    const surfaceOpinionVerdict = brief.executiveThesis.verdict;

    expect(surfaceHeroVerdict).toBe("CONSIDER");
    expect(surfaceSummaryVerdict).toBe("CONSIDER");
    expect(surfaceOpinionVerdict).toBe("CONSIDER");
  });
});
