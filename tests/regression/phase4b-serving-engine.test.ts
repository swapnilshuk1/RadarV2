/**
 * tests/phase4b-serving-engine.test.ts
 *
 * RADAR V4 — Phase 4B Comprehensive Verification Suite
 * Validates the 14-test matrix for Canonical Intrinsic Evaluation + Contextual Serving.
 */

import { describe, it, expect } from "vitest";
import {
  serveEvaluation,
  isCanonicalIntrinsicEvaluation,
  type CanonicalIntrinsicEvaluationPayload,
  type CandidateServingContext,
} from "../../src/lib/intelligence/serving/EvaluationServingEngine";
import {
  computeEffectiveDecision,
  computeReviewWorkflowState,
  determinePopulationTier,
  RankingPopulationTier,
  type UserDecisionStateV4,
} from "../../src/domain/decision_v4";

describe("RADAR V4 Phase 4B — Canonical Intrinsic Evaluation & Dynamic Serving Suite", () => {
  const sampleCanonicalIntrinsic: CanonicalIntrinsicEvaluationPayload = {
    schemaVersion: "v4.2-intrinsic",
    jobHash: "job_hash_executive_vp_001",
    personId: "person_swapnil_001",
    evaluationInputHash: "eval_input_hash_abc123",
    policyVersion: "v4.3",
    ontologyVersion: "v2",
    evaluatedAt: "2026-08-18T10:00:00.000Z",
    intrinsicVerdict: "PURSUE",
    intrinsicQualityScore: 94.5,
    parsingConfidence: 0.95,
    vetoed: false,
    vetoReason: null,
    triggeredRuleIds: ["RULE_VP_SCALE_MATCH", "RULE_COMMERCIAL_PNL"],
    decisionRisks: [{ factor: "Reporting Line", impact: "negative", strength: "low", evidence: "Reports to COO" }],
    decisionDrivers: [{ factor: "P&L Scale", impact: "positive", strength: "high", evidence: "$50M+ ARR" }],
    relativeDifferentiator: "Commercial Growth Velocity",
    trajectoryUpside: "Path to Group CXO within 24 months",
    opportunityScoreConfidence: "HIGH",
    opportunityScoreSource: "EXPLICIT",
    evaluationStatus: "COMPLETE",
    dimensions: [
      {
        key: "mandate",
        label: "Mandate Overlap",
        importance: "Core",
        bucket: "Verified",
        value: "Direct GM Ownership",
        quote: "Oversee global sales & marketing operations",
      },
    ],
    esi: 92.0,
    diligenceStatus: "READY",
    baseNarrative: {
      whyNow: "Expansion into North America enterprise segment",
      positioning: "Tier-1 Commercial Transformation Leader",
      primaryProof: "Scaled enterprise ARR from $10M to $60M",
      hiringRisk: "Fast-evolving board expectations",
      alternativePath: "Advisory role if full-time mandate shifts",
      recommendationArchetype: "Growth Orchestrator",
      recommendationArchetypeTagline: "High leverage scale acceleration",
      mandateArchetype: "Enterprise Scale",
      primaryDriver: "Commercial Execution",
      secondaryDriver: "International Expansion",
      primaryRisk: "Board reporting frequency",
      tailoringEffort: "Low",
      capabilityAlignmentText: "95% overlap across core enterprise dimensions",
      baseRecommendationProse: "Proceed with Tier-1 priority outreach this week.",
      recommendedAction: "PURSUE",
    },
    auditTrace: {
      verb0: "PURSUE",
      evaluationTimeFinalVerb: "PURSUE",
      careerValue: 92.0,
      shortlistingPotential: 96.0,
      pursuitFriction: 1.0,
      rawScore: 94.5,
      evidenceMappingCount: 1,
    },
  };

  const sampleOppContext = {
    title: "VP Global Commercial Growth",
    company: "Acme Corp",
    location: "Bengaluru (Hybrid)",
    salary: "₹2.5 Cr",
  };

  // Test 1: Pure serving from cached intrinsic row without DB mutation
  it("Test 1: serves pure evaluation DTO from cached intrinsic row without side effects", () => {
    const candCtx: CandidateServingContext = {
      personId: "person_swapnil_001",
      attentionWindow: 6,
      activePursuits: 2,
    };

    const served = serveEvaluation(sampleCanonicalIntrinsic, candCtx, sampleOppContext, null);

    expect(served.jobHash).toBe("job_hash_executive_vp_001");
    expect(served.engineRecommendation.engineVerdict).toBe("PURSUE");
    expect(served.engineRecommendation.verb0).toBe("PURSUE");
    expect(served.engineRecommendation.qualityScore).toBe(94.5);
    expect(served.effectiveDecision).toBe("ENGINE_PURSUIT");
    expect(served.reviewWorkflowState).toBe("UNREVIEWED");
    expect(served.displayScore).toBe("95%");
    expect(served.uiBadge).toEqual({ label: "Recommended", variant: "signal" });
  });

  // Test 2: Dynamic headspace downgrade (PURSUE -> CONSIDER when activePursuits >= attentionWindow)
  it("Test 2: dynamically downgrades PURSUE to CONSIDER when activePursuits >= attentionWindow", () => {
    const unsaturatedCtx: CandidateServingContext = {
      personId: "person_swapnil_001",
      attentionWindow: 6,
      activePursuits: 5,
    };
    const saturatedCtx: CandidateServingContext = {
      personId: "person_swapnil_001",
      attentionWindow: 6,
      activePursuits: 6, // At capacity!
    };

    const servedUnsaturated = serveEvaluation(sampleCanonicalIntrinsic, unsaturatedCtx, sampleOppContext, null);
    expect(servedUnsaturated.engineRecommendation.engineVerdict).toBe("PURSUE");
    expect(servedUnsaturated.decision).toBe("PURSUE");
    expect(servedUnsaturated.effectiveDecision).toBe("ENGINE_PURSUIT");

    const servedSaturated = serveEvaluation(sampleCanonicalIntrinsic, saturatedCtx, sampleOppContext, null);
    expect(servedSaturated.engineRecommendation.engineVerdict).toBe("CONSIDER");
    expect(servedSaturated.decision).toBe("CONSIDER");
    expect(servedSaturated.effectiveDecision).toBe("ENGINE_CONSIDER");
    expect(servedSaturated.engineRecommendation.verb0).toBe("PURSUE"); // Intrinsic verb0 remains immutable PURSUE
    expect(servedSaturated.recommendation).toContain("You are at capacity (6/6 active pursuits)");
  });

  // Test 3: Intrinsic non-PURSUE immunity (CONSIDER is NEVER downgraded to PASS)
  it("Test 3: guarantees CONSIDER is never downgraded to PASS under headspace saturation", () => {
    const intrinsicConsider: CanonicalIntrinsicEvaluationPayload = {
      ...sampleCanonicalIntrinsic,
      intrinsicVerdict: "CONSIDER",
      auditTrace: {
        ...sampleCanonicalIntrinsic.auditTrace,
        verb0: "CONSIDER",
      },
    };

    const saturatedCtx: CandidateServingContext = {
      personId: "person_swapnil_001",
      attentionWindow: 6,
      activePursuits: 10,
    };

    const served = serveEvaluation(intrinsicConsider, saturatedCtx, sampleOppContext, null);
    expect(served.engineRecommendation.engineVerdict).toBe("CONSIDER");
    expect(served.effectiveDecision).toBe("ENGINE_CONSIDER");
    expect(served.engineRecommendation.verb0).toBe("CONSIDER");
  });

  // Test 4: Intrinsic PASS immunity (PASS remains PASS)
  it("Test 4: guarantees PASS remains PASS under all headspace conditions", () => {
    const intrinsicPass: CanonicalIntrinsicEvaluationPayload = {
      ...sampleCanonicalIntrinsic,
      intrinsicVerdict: "PASS",
      auditTrace: {
        ...sampleCanonicalIntrinsic.auditTrace,
        verb0: "PASS",
      },
    };

    const candCtx: CandidateServingContext = {
      personId: "person_swapnil_001",
      attentionWindow: 6,
      activePursuits: 1,
    };

    const served = serveEvaluation(intrinsicPass, candCtx, sampleOppContext, null);
    expect(served.engineRecommendation.engineVerdict).toBe("PASS");
    expect(served.effectiveDecision).toBe("ENGINE_PASS");
  });

  // Test 5: User override reconciliation: intrinsic PURSUE + user PASS -> effective USER_PASSED
  it("Test 5: reconciles intrinsic PURSUE + user PASS into effective USER_PASSED", () => {
    const candCtx: CandidateServingContext = { personId: "p1", attentionWindow: 6, activePursuits: 1 };
    const userPass: UserDecisionStateV4 = {
      personId: "p1",
      jobHash: sampleCanonicalIntrinsic.jobHash,
      userAction: "PASS",
      reviewedFingerprint: sampleCanonicalIntrinsic.evaluationInputHash,
    };

    const served = serveEvaluation(sampleCanonicalIntrinsic, candCtx, sampleOppContext, userPass);
    expect(served.effectiveDecision).toBe("USER_PASSED");
    expect(served.decision).toBe("PASS");
    expect(served.engineRecommendation.engineVerdict).toBe("PURSUE"); // Engine's recommendation preserved
  });

  // Test 6: User override reconciliation: intrinsic CONSIDER + user PURSUE -> effective PREFERENCE_OVERRIDE
  it("Test 6: reconciles intrinsic CONSIDER + user PURSUE into effective PREFERENCE_OVERRIDE", () => {
    const intrinsicConsider: CanonicalIntrinsicEvaluationPayload = {
      ...sampleCanonicalIntrinsic,
      intrinsicVerdict: "CONSIDER",
    };
    const candCtx: CandidateServingContext = { personId: "p1", attentionWindow: 6, activePursuits: 1 };
    const userPursue: UserDecisionStateV4 = {
      personId: "p1",
      jobHash: sampleCanonicalIntrinsic.jobHash,
      userAction: "PURSUE",
      reviewedFingerprint: sampleCanonicalIntrinsic.evaluationInputHash,
    };

    const served = serveEvaluation(intrinsicConsider, candCtx, sampleOppContext, userPursue);
    expect(served.effectiveDecision).toBe("PREFERENCE_OVERRIDE");
    expect(served.decision).toBe("PURSUE");
  });

  // Test 7: Vetoed opportunity: intrinsic PASS (vetoed) + user PURSUE -> effective VETO_OVERRIDE
  it("Test 7: reconciles vetoed opportunity + user PURSUE into effective VETO_OVERRIDE", () => {
    const intrinsicVetoed: CanonicalIntrinsicEvaluationPayload = {
      ...sampleCanonicalIntrinsic,
      intrinsicVerdict: "PASS",
      vetoed: true,
      vetoReason: "Location mismatch: Requires full-time relocation to London",
    };
    const candCtx: CandidateServingContext = { personId: "p1", attentionWindow: 6, activePursuits: 1 };
    const userPursue: UserDecisionStateV4 = {
      personId: "p1",
      jobHash: sampleCanonicalIntrinsic.jobHash,
      userAction: "PURSUE",
      reviewedFingerprint: sampleCanonicalIntrinsic.evaluationInputHash,
    };

    const served = serveEvaluation(intrinsicVetoed, candCtx, sampleOppContext, userPursue);
    expect(served.effectiveDecision).toBe("VETO_OVERRIDE");
    expect(served.decision).toBe("PURSUE");
    expect(served.engineRecommendation.vetoed).toBe(true);
  });

  // Test 8: Unreviewed opportunity: userAction NONE -> reviewWorkflowState UNREVIEWED
  it("Test 8: sets reviewWorkflowState to UNREVIEWED when user has not acted", () => {
    const candCtx: CandidateServingContext = { personId: "p1", attentionWindow: 6, activePursuits: 1 };
    const served = serveEvaluation(sampleCanonicalIntrinsic, candCtx, sampleOppContext, null);
    expect(served.reviewWorkflowState).toBe("UNREVIEWED");
  });

  // Test 9: Stale review detection: user reviewed older fingerprint -> REVIEWED_STALE
  it("Test 9: detects REVIEWED_STALE when user decision fingerprint does not match current evaluation", () => {
    const candCtx: CandidateServingContext = { personId: "p1", attentionWindow: 6, activePursuits: 1 };
    const staleUserDecision: UserDecisionStateV4 = {
      personId: "p1",
      jobHash: sampleCanonicalIntrinsic.jobHash,
      userAction: "PURSUE",
      reviewedFingerprint: "older_superseded_fingerprint_999",
    };

    const served = serveEvaluation(sampleCanonicalIntrinsic, candCtx, sampleOppContext, staleUserDecision);
    expect(served.reviewWorkflowState).toBe("REVIEWED_STALE");
  });

  // Test 10: Current review detection: matching fingerprint -> REVIEWED_CURRENT
  it("Test 10: detects REVIEWED_CURRENT when user decision fingerprint matches current evaluation", () => {
    const candCtx: CandidateServingContext = { personId: "p1", attentionWindow: 6, activePursuits: 1 };
    const currentUserDecision: UserDecisionStateV4 = {
      personId: "p1",
      jobHash: sampleCanonicalIntrinsic.jobHash,
      userAction: "PURSUE",
      reviewedFingerprint: sampleCanonicalIntrinsic.evaluationInputHash,
    };

    const served = serveEvaluation(sampleCanonicalIntrinsic, candCtx, sampleOppContext, currentUserDecision);
    expect(served.reviewWorkflowState).toBe("REVIEWED_CURRENT");
  });

  // Test 12: Base narrative immutability: serving does NOT mutate the cached baseNarrative object
  it("Test 12: ensures serving dynamic headspace advisory never mutates cached baseNarrative object", () => {
    const originalProse = sampleCanonicalIntrinsic.baseNarrative.baseRecommendationProse;
    const saturatedCtx: CandidateServingContext = {
      personId: "p1",
      attentionWindow: 6,
      activePursuits: 6,
    };

    const served = serveEvaluation(sampleCanonicalIntrinsic, saturatedCtx, sampleOppContext, null);
    expect(served.recommendation).toContain("You are at capacity (6/6 active pursuits)");
    // Cached intrinsic object must remain completely pristine!
    expect(sampleCanonicalIntrinsic.baseNarrative.baseRecommendationProse).toBe(originalProse);
    expect(sampleCanonicalIntrinsic.baseNarrative.baseRecommendationProse).not.toContain("You are at capacity");
  });

  // Test 13: Audit trace preservation: served recommendation preserves verb0 and evaluationTimeFinalVerb
  it("Test 13: preserves full audit trace (verb0, evaluationTimeFinalVerb, factors) on served recommendation", () => {
    const candCtx: CandidateServingContext = { personId: "p1", attentionWindow: 6, activePursuits: 1 };
    const served = serveEvaluation(sampleCanonicalIntrinsic, candCtx, sampleOppContext, null);

    expect(served.engineRecommendation.verb0).toBe("PURSUE");
    expect(served.engineRecommendation.evaluationTimeFinalVerb).toBe("PURSUE");
    expect(sampleCanonicalIntrinsic.auditTrace.careerValue).toBe(92.0);
    expect(sampleCanonicalIntrinsic.auditTrace.shortlistingPotential).toBe(96.0);
    expect(sampleCanonicalIntrinsic.auditTrace.pursuitFriction).toBe(1.0);
  });

  // Test 14: Population tier sorting: homogeneous ranking orders Tier 0 > Tier 1 > Tier 2 > Tier 3 > Tier 4 > Tier 5
  it("Test 14: accurately maps population tiers for homogeneous queue ranking", () => {
    const enginePursue = sampleCanonicalIntrinsic.engineRecommendation || {
      jobHash: "1",
      evaluationFingerprint: "fp",
      engineVerdict: "PURSUE",
      vetoed: false,
      vetoReason: null,
      qualityScore: 90,
      parsingConfidence: 1,
      evaluatedAt: "",
    };

    expect(determinePopulationTier("ENGINE_PURSUIT", enginePursue)).toBe(RankingPopulationTier.TIER_0_ENGINE_RECOMMENDED);
    expect(determinePopulationTier("USER_CONFIRMED", enginePursue)).toBe(RankingPopulationTier.TIER_0_ENGINE_RECOMMENDED);
    expect(determinePopulationTier("PREFERENCE_OVERRIDE", enginePursue)).toBe(RankingPopulationTier.TIER_1_PREFERENCE_OVERRIDE);
    expect(determinePopulationTier("VETO_OVERRIDE", enginePursue)).toBe(RankingPopulationTier.TIER_2_VETO_OVERRIDE);
    expect(determinePopulationTier("ENGINE_CONSIDER", enginePursue)).toBe(RankingPopulationTier.TIER_3_ENGINE_CONSIDER);
    expect(determinePopulationTier("NOT_EVALUABLE", enginePursue)).toBe(RankingPopulationTier.TIER_4_NOT_EVALUABLE);
    expect(determinePopulationTier("USER_PASSED", enginePursue)).toBe(RankingPopulationTier.TIER_5_PASS_ARCHIVE);
    expect(determinePopulationTier("ENGINE_PASS", enginePursue)).toBe(RankingPopulationTier.TIER_5_PASS_ARCHIVE);

    // Verify numeric tier progression guarantees proper ordering
    expect(RankingPopulationTier.TIER_0_ENGINE_RECOMMENDED).toBeLessThan(RankingPopulationTier.TIER_1_PREFERENCE_OVERRIDE);
    expect(RankingPopulationTier.TIER_1_PREFERENCE_OVERRIDE).toBeLessThan(RankingPopulationTier.TIER_2_VETO_OVERRIDE);
    expect(RankingPopulationTier.TIER_2_VETO_OVERRIDE).toBeLessThan(RankingPopulationTier.TIER_3_ENGINE_CONSIDER);
    expect(RankingPopulationTier.TIER_3_ENGINE_CONSIDER).toBeLessThan(RankingPopulationTier.TIER_4_NOT_EVALUABLE);
    expect(RankingPopulationTier.TIER_4_NOT_EVALUABLE).toBeLessThan(RankingPopulationTier.TIER_5_PASS_ARCHIVE);
  });
});
