import { describe, it, expect } from "vitest";
import { resolveDossierDecisionState } from "../../src/lib/intelligence/decision-state";
import { BriefCompositionEngine } from "../../src/lib/intelligence/editorial/BriefCompositionEngine";

describe("RADAR V4 — Dossier Decision-State & Editorial Integrity", () => {
  const baseOpportunity = {
    id: "opp_test_001",
    jobHash: "hash_test_001",
    role: "VP Engineering",
    company: "Acme Corp",
    decision: "CONSIDER",
    archetype: "TECHNOLOGY_LEADERSHIP",
  };

  it("CASE A — engine=PURSUE, user=null, score=75 => Primary: PURSUE, State: NONE", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: {
        engineVerdict: "PURSUE",
        evaluationFingerprint: "fp_v1_001",
      },
    };
    const state = resolveDossierDecisionState(opp, null);
    expect(state.engineVerdict).toBe("PURSUE");
    expect(state.userDecision).toBeNull();
    expect(state.userDecisionState).toBe("NONE");
    expect(state.selectedActionForControls).toBe("PURSUE");
  });

  it("CASE B — engine=CONSIDER, user=null, score=60 => Primary: CONSIDER, State: NONE", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        evaluationFingerprint: "fp_v1_001",
      },
    };
    const state = resolveDossierDecisionState(opp, null);
    expect(state.engineVerdict).toBe("CONSIDER");
    expect(state.userDecision).toBeNull();
    expect(state.userDecisionState).toBe("NONE");
  });

  it("CASE C — engine=CONSIDER, user=PURSUE, matching fingerprints => State: CURRENT", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        evaluationFingerprint: "fp_v1_matching",
      },
    };
    const userRec = { verb: "PURSUE" as const, reviewedFingerprint: "fp_v1_matching" };
    const state = resolveDossierDecisionState(opp, userRec);

    expect(state.engineVerdict).toBe("CONSIDER");
    expect(state.userDecision).toBe("PURSUE");
    expect(state.userDecisionState).toBe("CURRENT");
    expect(state.selectedActionForControls).toBe("PURSUE");
  });

  it("CASE D — engine=CONSIDER, user=PURSUE, differing fingerprints => State: STALE", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        evaluationFingerprint: "fp_v2_new_evaluation",
      },
    };
    const userRec = { verb: "PURSUE" as const, reviewedFingerprint: "fp_v1_old_decision" };
    const state = resolveDossierDecisionState(opp, userRec);

    expect(state.engineVerdict).toBe("CONSIDER");
    expect(state.userDecision).toBe("PURSUE");
    expect(state.userDecisionState).toBe("STALE");
  });

  it("CASE E — engine=CONSIDER, user=PASS => Primary: CONSIDER, UserChoice: PASS", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        evaluationFingerprint: "fp_v1_001",
      },
    };
    const userRec = { verb: "PASS" as const, reviewedFingerprint: "fp_v1_001" };
    const state = resolveDossierDecisionState(opp, userRec);

    expect(state.engineVerdict).toBe("CONSIDER");
    expect(state.userDecision).toBe("PASS");
    expect(state.selectedActionForControls).toBe("PASS");
  });

  it("CASE F — engine=PURSUE, user=CONSIDER => Primary: PURSUE, UserChoice: CONSIDER", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: {
        engineVerdict: "PURSUE",
        evaluationFingerprint: "fp_v1_001",
      },
    };
    const userRec = { verb: "CONSIDER" as const, reviewedFingerprint: "fp_v1_001" };
    const state = resolveDossierDecisionState(opp, userRec);

    expect(state.engineVerdict).toBe("PURSUE");
    expect(state.userDecision).toBe("CONSIDER");
  });

  it("CASE G — engine=CONSIDER, user=PURSUE, score=NULL => No score mutation", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        evaluationFingerprint: "fp_v1_001",
      },
    };
    const userRec = { verb: "PURSUE" as const, reviewedFingerprint: "fp_v1_001" };
    const state = resolveDossierDecisionState(opp, userRec);

    expect(state.engineVerdict).toBe("CONSIDER");
    expect(state.userDecision).toBe("PURSUE");
  });

  it("CASE H — engine=PASS, user=PURSUE, score=NULL => Primary: PASS, UserChoice: PURSUE", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: {
        engineVerdict: "PASS",
        evaluationFingerprint: "fp_v1_001",
      },
    };
    const userRec = { verb: "PURSUE" as const, reviewedFingerprint: "fp_v1_001" };
    const state = resolveDossierDecisionState(opp, userRec);

    expect(state.engineVerdict).toBe("PASS");
    expect(state.userDecision).toBe("PURSUE");
  });

  it("CASE I — Missing engine authority => Primary: null (RECOMMENDATION UNAVAILABLE)", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: null,
      recommendationResult: { decision: "PURSUE" }, // False fallback attempt
    };
    const userRec = { verb: "PURSUE" as const, reviewedFingerprint: "fp_v1_001" };
    const state = resolveDossierDecisionState(opp, userRec);

    // Invariant: Missing engine authority MUST resolve to null
    expect(state.engineVerdict).toBeNull();
    expect(state.userDecision).toBe("PURSUE");
    expect(state.selectedActionForControls).toBe("PURSUE");
  });

  it("CASE J — Missing fingerprint => State: UNVERIFIABLE", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        evaluationFingerprint: null, // Missing current fingerprint
      },
    };
    const userRec = { verb: "PURSUE" as const, reviewedFingerprint: null };
    const state = resolveDossierDecisionState(opp, userRec);

    expect(state.engineVerdict).toBe("CONSIDER");
    expect(state.userDecision).toBe("PURSUE");
    expect(state.userDecisionState).toBe("UNVERIFIABLE");
  });

  it("CASE K — Editorial Isolation: User Override (PURSUE) Must NOT Leak Into BriefCompositionEngine", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        evaluationFingerprint: "fp_v1_001",
      },
      decision: "PURSUE", // Persisted user decision in legacy field
    };

    const brief = BriefCompositionEngine.compose(opp, { bypassHistory: true });
    // Invariant: BriefCompositionEngine must reflect the engine recommendation (CONSIDER)
    expect(brief.qualitativeRecommendation).toBe("Conditional Consideration");
    expect(brief.qualitativeRecommendation).not.toBe("Strong Pursue Recommendation");
  });

  it("CASE L — Editorial Isolation: Stale User Override (PURSUE) Must NOT Leak Into BriefCompositionEngine", () => {
    const opp = {
      ...baseOpportunity,
      engineRecommendation: {
        engineVerdict: "PASS",
        evaluationFingerprint: "fp_v2_new_eval",
      },
      decision: "PURSUE", // Stale user choice
    };

    const brief = BriefCompositionEngine.compose(opp, { bypassHistory: true });
    expect(brief.qualitativeRecommendation).toBe("Strategic Pass");
    expect(brief.qualitativeRecommendation).not.toBe("Strong Pursue Recommendation");
  });

  it("CASE M — Fail-Closed Controls: engine=null, user=null, score=85 => selectedActionForControls = null", () => {
    const opp = {
      ...baseOpportunity,
      qualityScore: 85,
      recommendationResult: { score: 85, decision: "PURSUE" }, // Untrusted fallback attempt
      engineRecommendation: null,
    };

    const state = resolveDossierDecisionState(opp, null);

    expect(state.engineVerdict).toBeNull();
    expect(state.userDecision).toBeNull();
    expect(state.userDecisionState).toBe("NONE");
    expect(state.selectedActionForControls).toBeNull();
    expect(state.evaluationFingerprint).toBeNull();
  });
});
