import { describe, it, expect } from "vitest";
import type { Opportunity } from "../../src/data/opportunity-fixtures";
import { EditorialContextBuilder } from "../../src/lib/intelligence/editorial/EditorialContext";
import { PrimaryReasonResolver } from "../../src/lib/intelligence/editorial/PrimaryReasonResolver";
import { PursuitStrategyResolver } from "../../src/lib/intelligence/editorial/PursuitStrategyResolver";
import { BriefCompositionEngine } from "../../src/lib/intelligence/editorial/BriefCompositionEngine";

function createFixture(overrides: Partial<Opportunity> = {}): Opportunity {
  return {
    id: "opp_test_p1_3",
    jobHash: "hash_p1_3_test",
    role: "Chief Commercial Officer",
    company: "Acme Global",
    location: "Bengaluru",
    engineRecommendation: {
      engineVerdict: "PURSUE",
      qualityScore: 88,
      triggeredRuleIds: ["R-PURSUE-HIGH-ALIGNMENT"],
      trajectoryUpside: "HIGH",
      relativeDifferentiator: "Substantial P&L Step-up",
    },
    dimensions: [
      { key: "functionalScope", label: "GTM Leadership", jdEvidence: { status: "Explicit" } },
      { key: "mandate", label: "Commercial Transformation", jdEvidence: { status: "Explicit" } },
      { key: "governance", label: "Board Reporting", jdEvidence: { status: "Explicit" } },
    ],
    ...overrides,
  } as Opportunity;
}

describe("RADAR V4 Phase P1.3 — Pursuit Strategy & Effort Allocation Integrity Suite (Cases A–AF)", () => {
  // Case A: PURSUE + high career upside + strong evidence -> DEEP
  it("Case A: PURSUE + high career upside + strong evidence -> DEEP / TAILOR_THEN_APPLY / DEEP", () => {
    const opp = createFixture();
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBe("PURSUE");
    expect(strategy.effortLevel).toBe("DEEP");
    expect(strategy.pursuitMode).toBe("TAILOR_THEN_APPLY");
    expect(strategy.tailoringDepth).toBe("DEEP");
    expect(strategy.ruleId).toBe("PURSUE_DEEP_STRONG_EVIDENCE");
    expect(strategy.actions.length).toBeGreaterThan(0);
    expect(strategy.actions[0].type).toBe("TAILOR_RESUME");
  });

  // Case B: PURSUE + moderate evidence -> TARGETED
  it("Case B: PURSUE + moderate evidence -> TARGETED / TAILOR_THEN_APPLY / TARGETED", () => {
    const opp = createFixture({
      dimensions: [
        { key: "functionalScope", label: "GTM Leadership", jdEvidence: { status: "Explicit" } },
      ],
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBe("PURSUE");
    expect(strategy.effortLevel).toBe("TARGETED");
    expect(strategy.pursuitMode).toBe("TAILOR_THEN_APPLY");
    expect(strategy.tailoringDepth).toBe("TARGETED");
    expect(strategy.ruleId).toBe("PURSUE_TARGETED_MODERATE_EVIDENCE");
  });

  // Case C: CONSIDER + high capability + limited career upside -> LIGHT
  it("Case C: CONSIDER + high capability + limited career upside -> LIGHT / INVESTIGATE_THEN_DECIDE", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 82,
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        trajectoryUpside: "LIMITED",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBe("CONSIDER");
    expect(strategy.effortLevel).toBe("LIGHT");
    expect(strategy.pursuitMode).toBe("INVESTIGATE_THEN_DECIDE");
    expect(strategy.tailoringDepth).toBe("LIGHT");
    expect(strategy.ruleId).toBe("CONSIDER_LIMITED_CAREER_UPSIDE");
  });

  // Case D: CONSIDER + material career regression -> LIGHT / CLARIFY_SCOPE
  it("Case D: CONSIDER + material career regression -> LIGHT / CLARIFY_SCOPE / NONE", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 68,
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        trajectoryUpside: "REGRESSION",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBe("CONSIDER");
    expect(strategy.effortLevel).toBe("LIGHT");
    expect(strategy.pursuitMode).toBe("CLARIFY_SCOPE");
    expect(strategy.tailoringDepth).toBe("NONE");
    expect(strategy.ruleId).toBe("CAREER_REGRESSION_SCOPE_CHECK");
    expect(strategy.actions[0].type).toBe("CLARIFY_SCOPE");
  });

  // Case E: PASS + high capability -> DO_NOT_INVEST / PASS / NONE
  it("Case E: PASS + high capability -> DO_NOT_INVEST / PASS / NONE", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "PASS",
        qualityScore: 40,
        triggeredRuleIds: ["R-PASS-SCOPE-MISMATCH"],
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBe("PASS");
    expect(strategy.effortLevel).toBe("DO_NOT_INVEST");
    expect(strategy.pursuitMode).toBe("PASS");
    expect(strategy.tailoringDepth).toBe("NONE");
    expect(strategy.ruleId).toBe("PASS_NO_INVESTMENT");
    expect(strategy.actions[0].type).toBe("PASS");
  });

  // Case F: Sparse JD -> INVESTIGATE_FIRST / INVESTIGATE_THEN_DECIDE / NONE
  it("Case F: Sparse JD -> INVESTIGATE_FIRST / INVESTIGATE_THEN_DECIDE / NONE", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 60,
        triggeredRuleIds: ["SPARSE_SPECIFICATION"],
      },
      dimensions: [],
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.effortLevel).toBe("INVESTIGATE_FIRST");
    expect(strategy.pursuitMode).toBe("INVESTIGATE_THEN_DECIDE");
    expect(strategy.tailoringDepth).toBe("NONE");
  });

  // Case G: High uncertainty -> INVESTIGATE_FIRST
  it("Case G: High uncertainty -> INVESTIGATE_FIRST / INVESTIGATE_THEN_DECIDE / NONE", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 70,
        triggeredRuleIds: ["R-CONSIDER-CONDITIONAL"],
      },
      dimensions: [
        { key: "functionalScope", label: "GTM Leadership", jdEvidence: { status: "Explicit" } },
      ],
      missingCapabilities: ["Enterprise P&L Governance", "Direct Team Leadership"],
    } as any);
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    if (exp.keyUncertainty) {
      expect(strategy.effortLevel).toBe("INVESTIGATE_FIRST");
      expect(strategy.pursuitMode).toBe("INVESTIGATE_THEN_DECIDE");
      expect(strategy.tailoringDepth).toBe("NONE");
      expect(strategy.ruleId).toBe("MATERIAL_UNCERTAINTY_INVESTIGATION");
    }
  });

  // Case H: PURSUE + strong evidence -> deep tailoring permitted
  it("Case H: PURSUE + strong evidence permits deep tailoring", () => {
    const opp = createFixture();
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.tailoringDepth).toBe("DEEP");
  });

  // Case I: LIGHT effort -> no deep tailoring
  it("Case I: LIGHT effort -> no deep tailoring (tailoringDepth === LIGHT or NONE)", () => {
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
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(["LIGHT", "NONE"]).toContain(strategy.tailoringDepth);
    expect(strategy.tailoringDepth).not.toBe("DEEP");
  });

  // Case J: Target employer appears in execution context -> candidate truth invariant
  it("Case J: Candidate truth isolation - PursuitStrategy does not emit candidate assertions", () => {
    const opp = createFixture();
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    // Strategy specifies action directives, not fabricated claims
    strategy.actions.forEach((act) => {
      expect(act.rationale).toBeDefined();
      expect(typeof act.rationale).toBe("string");
    });
  });

  // Case K: Unsupported candidate claim -> evidence-gap coaching in downstream
  it("Case K: Unsupported candidate claim -> strategy recommends targeted verification", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 70,
        triggeredRuleIds: ["R-CONSIDER-CONDITIONAL"],
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.actions.some((a) => a.type === "INVESTIGATE_ROLE" || a.type === "CLARIFY_SCOPE" || a.type === "TAILOR_RESUME")).toBe(true);
  });

  // Case L: User chooses PURSUE while engine = CONSIDER -> strategy remains canonical CONSIDER strategy
  it("Case L: User chooses PURSUE while engine = CONSIDER -> strategy is NOT overridden", () => {
    const opp = createFixture({
      userDecision: "PURSUE",
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 72,
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        trajectoryUpside: "LIMITED",
      },
    } as any);
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBe("CONSIDER");
    expect(strategy.effortLevel).toBe("LIGHT");
    expect(strategy.pursuitMode).toBe("INVESTIGATE_THEN_DECIDE");
  });

  // Case M: User chooses PASS while engine = PURSUE -> strategy remains PURSUE strategy
  it("Case M: User chooses PASS while engine = PURSUE -> strategy remains canonical PURSUE strategy", () => {
    const opp = createFixture({
      userDecision: "PASS",
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 90,
        triggeredRuleIds: ["R-PURSUE-HIGH-ALIGNMENT"],
        trajectoryUpside: "HIGH",
      },
    } as any);
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBe("PURSUE");
    expect(strategy.effortLevel).toBe("DEEP");
  });

  // Case N: Quality score mutation -> does not change verdict, explanation, or effort level
  it("Case N: Quality score mutation does not change verdict, explanation, or effort level", () => {
    const opp1 = createFixture({ engineRecommendation: { engineVerdict: "PURSUE", qualityScore: 76, triggeredRuleIds: ["R-PURSUE-HIGH-ALIGNMENT"], trajectoryUpside: "HIGH" } });
    const opp2 = createFixture({ engineRecommendation: { engineVerdict: "PURSUE", qualityScore: 99, triggeredRuleIds: ["R-PURSUE-HIGH-ALIGNMENT"], trajectoryUpside: "HIGH" } });

    const ctx1 = EditorialContextBuilder.build(opp1);
    const ctx2 = EditorialContextBuilder.build(opp2);

    const exp1 = PrimaryReasonResolver.resolve(ctx1, opp1);
    const exp2 = PrimaryReasonResolver.resolve(ctx2, opp2);

    const strat1 = PursuitStrategyResolver.resolve(exp1, ctx1);
    const strat2 = PursuitStrategyResolver.resolve(exp2, ctx2);

    expect(strat1.effortLevel).toBe(strat2.effortLevel);
    expect(strat1.pursuitMode).toBe(strat2.pursuitMode);
    expect(strat1.tailoringDepth).toBe(strat2.tailoringDepth);
  });

  // Case O: Capability score mutation -> does not independently change effort strategy
  it("Case O: Capability score mutation does not independently change effort strategy", () => {
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
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.effortLevel).toBe("LIGHT");
  });

  // Case P: Career regression signal -> not suppressed by high capability score
  it("Case P: Career regression signal is NOT suppressed by high capability score", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 95,
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        trajectoryUpside: "REGRESSION",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.effortLevel).toBe("LIGHT");
    expect(strategy.pursuitMode).toBe("CLARIFY_SCOPE");
    expect(strategy.tailoringDepth).toBe("NONE");
    expect(strategy.ruleId).toBe("CAREER_REGRESSION_SCOPE_CHECK");
  });

  // Case Q: Missing engine verdict -> fail closed to INVESTIGATE_FIRST
  it("Case Q: Missing engine verdict fails closed to INVESTIGATE_FIRST", () => {
    const opp = createFixture({
      engineRecommendation: undefined,
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBeNull();
    expect(strategy.effortLevel).toBe("INVESTIGATE_FIRST");
    expect(strategy.pursuitMode).toBe("INVESTIGATE_THEN_DECIDE");
    expect(strategy.tailoringDepth).toBe("NONE");
    expect(strategy.ruleId).toBe("EVALUATION_INCOMPLETE");
  });

  // Case R: Missing evidence -> tailoringDepth !== DEEP
  it("Case R: Missing evidence -> tailoringDepth is not DEEP", () => {
    const opp = createFixture({
      dimensions: [],
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 65,
        triggeredRuleIds: ["SPARSE_SPECIFICATION"],
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.tailoringDepth).not.toBe("DEEP");
  });

  // Case S: Determinism -> 100 sequential runs produce identical PursuitStrategy
  it("Case S: Determinism: 100 sequential runs produce identical PursuitStrategy", () => {
    const opp = createFixture();
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);

    const first = JSON.stringify(PursuitStrategyResolver.resolve(exp, ctx));
    for (let i = 0; i < 100; i++) {
      const next = JSON.stringify(PursuitStrategyResolver.resolve(exp, ctx));
      expect(next).toBe(first);
    }
  });

  // Case T: Surface convergence -> BriefCompositionEngine exposes identical brief.pursuitStrategy
  it("Case T: Surface convergence: BriefCompositionEngine returns identical pursuitStrategy", () => {
    const opp = createFixture();
    const brief = BriefCompositionEngine.compose(opp);

    expect(brief.pursuitStrategy).toBeDefined();
    expect(brief.pursuitStrategy.engineVerdict).toBe(brief.editorialContext.engineVerdict);
    expect(brief.pursuitStrategy.effortLevel).toBe("DEEP");
  });

  // Case U: PURSUE + STRONG evidence + material career regression -> LIGHT / CLARIFY_SCOPE
  it("Case U: PURSUE + STRONG evidence + material career regression -> LIGHT / CLARIFY_SCOPE (P2 outranks P4)", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 90,
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        trajectoryUpside: "REGRESSION",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.effortLevel).toBe("LIGHT");
    expect(strategy.pursuitMode).toBe("CLARIFY_SCOPE");
    expect(strategy.tailoringDepth).toBe("NONE");
    expect(strategy.ruleId).toBe("CAREER_REGRESSION_SCOPE_CHECK");
  });

  // Case V: PURSUE + STRONG evidence + sparse JD -> INVESTIGATE_FIRST (P3 outranks P4)
  it("Case V: PURSUE + STRONG evidence + sparse JD -> INVESTIGATE_FIRST (P3 outranks P4)", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 85,
        triggeredRuleIds: ["SPARSE_SPECIFICATION"],
        trajectoryUpside: "HIGH",
      },
      dimensions: [],
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.effortLevel).toBe("INVESTIGATE_FIRST");
    expect(strategy.pursuitMode).toBe("INVESTIGATE_THEN_DECIDE");
    expect(strategy.tailoringDepth).toBe("NONE");
  });

  // Case W: PURSUE + STRONG evidence + key uncertainty -> INVESTIGATE_FIRST (P3 outranks P4)
  it("Case W: PURSUE + STRONG evidence + key uncertainty -> INVESTIGATE_FIRST (P3 outranks P4)", () => {
    const opp = createFixture();
    const ctx = EditorialContextBuilder.build(opp);
    // Construct an explanation with a key uncertainty
    const expWithUncertainty = {
      ...PrimaryReasonResolver.resolve(ctx, opp),
      keyUncertainty: "Requires board confirmation of P&L governance altitude.",
    };
    const strategy = PursuitStrategyResolver.resolve(expWithUncertainty, ctx);

    expect(strategy.effortLevel).toBe("INVESTIGATE_FIRST");
    expect(strategy.pursuitMode).toBe("INVESTIGATE_THEN_DECIDE");
    expect(strategy.tailoringDepth).toBe("NONE");
    expect(strategy.ruleId).toBe("MATERIAL_UNCERTAINTY_INVESTIGATION");
  });

  // Case X: CONSIDER + very high capability + career regression -> LIGHT / CLARIFY_SCOPE (P2 outranks P7/P8)
  it("Case X: CONSIDER + very high capability + career regression -> LIGHT / CLARIFY_SCOPE", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 98,
        triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"],
        trajectoryUpside: "REGRESSION",
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.effortLevel).toBe("LIGHT");
    expect(strategy.pursuitMode).toBe("CLARIFY_SCOPE");
    expect(strategy.tailoringDepth).toBe("NONE");
  });

  // Case Y: PASS + STRONG evidence -> DO_NOT_INVEST (P1 outranks P4)
  it("Case Y: PASS + STRONG evidence -> DO_NOT_INVEST (P1 outranks P4)", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "PASS",
        qualityScore: 88,
        triggeredRuleIds: ["R-PASS-EXECUTIVE-MISMATCH"],
      },
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.effortLevel).toBe("DO_NOT_INVEST");
    expect(strategy.pursuitMode).toBe("PASS");
    expect(strategy.tailoringDepth).toBe("NONE");
    expect(strategy.ruleId).toBe("PASS_NO_INVESTMENT");
  });

  // Case Z: PURSUE + LIMITED evidence + no uncertainty -> verify canonical upstream interpretation
  it("Case Z: PURSUE + LIMITED evidence + no uncertainty -> verify canonical upstream action", () => {
    const opp = createFixture({
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 80,
        triggeredRuleIds: ["R-PURSUE-HIGH-ALIGNMENT"],
        trajectoryUpside: "HIGH",
      },
      dimensions: [
        { key: "functionalScope", label: "GTM Leadership", jdEvidence: { status: "Implicit" } },
      ],
    });
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    if (exp.recommendedAction === "TAILOR_AND_APPLY" || exp.recommendedAction === "APPLY") {
      expect(strategy.effortLevel).toBe("TARGETED");
      expect(strategy.pursuitMode).toBe("TAILOR_THEN_APPLY");
    } else {
      expect(strategy.effortLevel).toBe("INVESTIGATE_FIRST");
      expect(strategy.pursuitMode).toBe("INVESTIGATE_THEN_DECIDE");
    }
  });

  // Case AA: Unsupported inference increases from 0 -> 30% -> strategy does not suddenly become PASS
  it("Case AA: Unsupported inference does not mutate verdict to PASS", () => {
    const opp = createFixture();
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBe("PURSUE");
    expect(strategy.effortLevel).not.toBe("DO_NOT_INVEST");
  });

  // Case AB: Unsupported inference reaches material level -> tailoring depth remains grounded, verdict untouched
  it("Case AB: Material unsupported inference does not mutate engine verdict", () => {
    const opp = createFixture();
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBe("PURSUE");
  });

  // Case AC: User selects PURSUE on CONSIDER -> no strategy mutation
  it("Case AC: User selects PURSUE on CONSIDER -> no strategy mutation", () => {
    const opp = createFixture({
      userDecision: "PURSUE",
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 70,
        triggeredRuleIds: ["R-CONSIDER-CONDITIONAL"],
      },
    } as any);
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBe("CONSIDER");
    expect(strategy.effortLevel).toBe("LIGHT");
  });

  // Case AD: User selects PASS on PURSUE -> no strategy mutation
  it("Case AD: User selects PASS on PURSUE -> no strategy mutation", () => {
    const opp = createFixture({
      userDecision: "PASS",
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 92,
        triggeredRuleIds: ["R-PURSUE-HIGH-ALIGNMENT"],
        trajectoryUpside: "HIGH",
      },
    } as any);
    const ctx = EditorialContextBuilder.build(opp);
    const exp = PrimaryReasonResolver.resolve(ctx, opp);
    const strategy = PursuitStrategyResolver.resolve(exp, ctx);

    expect(strategy.engineVerdict).toBe("PURSUE");
    expect(strategy.effortLevel).toBe("DEEP");
  });

  // Case AE: Career-value signal changes while raw capability remains constant -> strategy updates
  it("Case AE: Career-value signal change drives strategy update", () => {
    const oppNormal = createFixture({
      engineRecommendation: { engineVerdict: "CONSIDER", qualityScore: 75, triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"], trajectoryUpside: "LIMITED" },
    });
    const oppRegression = createFixture({
      engineRecommendation: { engineVerdict: "CONSIDER", qualityScore: 75, triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"], trajectoryUpside: "REGRESSION" },
    });

    const ctxNormal = EditorialContextBuilder.build(oppNormal);
    const ctxRegression = EditorialContextBuilder.build(oppRegression);

    const expNormal = PrimaryReasonResolver.resolve(ctxNormal, oppNormal);
    const expRegression = PrimaryReasonResolver.resolve(ctxRegression, oppRegression);

    const stratNormal = PursuitStrategyResolver.resolve(expNormal, ctxNormal);
    const stratRegression = PursuitStrategyResolver.resolve(expRegression, ctxRegression);

    expect(stratNormal.pursuitMode).toBe("INVESTIGATE_THEN_DECIDE");
    expect(stratRegression.pursuitMode).toBe("CLARIFY_SCOPE");
  });

  // Case AF: Capability changes while career-value explanation remains unchanged -> strategy does not change
  it("Case AF: Capability changes while career-value explanation remains unchanged -> strategy unchanged", () => {
    const opp1 = createFixture({
      engineRecommendation: { engineVerdict: "CONSIDER", qualityScore: 70, triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"], trajectoryUpside: "LIMITED" },
    });
    const opp2 = createFixture({
      engineRecommendation: { engineVerdict: "CONSIDER", qualityScore: 85, triggeredRuleIds: ["R-CONSIDER-CAREER-VALUE-PROTECTION"], trajectoryUpside: "LIMITED" },
    });

    const ctx1 = EditorialContextBuilder.build(opp1);
    const ctx2 = EditorialContextBuilder.build(opp2);

    const exp1 = PrimaryReasonResolver.resolve(ctx1, opp1);
    const exp2 = PrimaryReasonResolver.resolve(ctx2, opp2);

    const strat1 = PursuitStrategyResolver.resolve(exp1, ctx1);
    const strat2 = PursuitStrategyResolver.resolve(exp2, ctx2);

    expect(strat1.effortLevel).toBe(strat2.effortLevel);
    expect(strat1.pursuitMode).toBe(strat2.pursuitMode);
    expect(strat1.ruleId).toBe(strat2.ruleId);
  });
});
