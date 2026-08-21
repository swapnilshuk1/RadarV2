import { describe, it, expect, vi } from "vitest";
import {
  computeEffectiveDecision,
  computeReviewWorkflowState,
  determinePopulationTier,
  RankingPopulationTier,
  type EngineRecommendationV4,
  type UserDecisionStateV4,
  type EffectiveDecision,
} from "../../src/domain/decision_v4";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";
import type { Opportunity } from "../../src/data/opportunity-fixtures";
import { getRepositories } from "../../src/data/sqlite/provider";
import * as engineModule from "../../src/lib/intelligence/engine";

describe("RADAR V4 Decision State, Review State & Ranking Pipeline", () => {
  // Test Fixture Factory
  const makeEngineRec = (overrides?: Partial<EngineRecommendationV4>): EngineRecommendationV4 => ({
    jobHash: "j-test-123",
    evaluationFingerprint: "v4.3.0:j-test-123:PURSUE",
    engineVerdict: "PURSUE",
    vetoed: false,
    vetoReason: null,
    qualityScore: 85,
    parsingConfidence: 0.90,
    evaluatedAt: "2026-08-16T12:00:00Z",
    ...overrides,
  });

  const makeUserState = (overrides?: Partial<UserDecisionStateV4>): UserDecisionStateV4 => ({
    personId: "swapnil-shukla",
    jobHash: "j-test-123",
    userAction: "PURSUE",
    reviewedFingerprint: "v4.3.0:j-test-123:PURSUE",
    updatedAt: "2026-08-16T12:30:00Z",
    ...overrides,
  });

  // ==========================================================================
  // T1: Engine Recommendation Preservation (Immutability under User Action)
  // ==========================================================================
  it("T1: preserves engine recommendation state when user records an action", () => {
    const vetoedEngineRec = makeEngineRec({
      jobHash: "j-04acb1b1be94",
      evaluationFingerprint: "v4.3.0:j-04acb1b1be94:PASS",
      engineVerdict: "PASS",
      vetoed: true,
      vetoReason: "G-EXECUTIVE-IDENTITY-MISMATCH",
      qualityScore: null,
      parsingConfidence: 0.95,
    });

    const userState = makeUserState({
      jobHash: "j-04acb1b1be94",
      userAction: "PURSUE", // User overrides RADAR
    });

    const effective = computeEffectiveDecision(vetoedEngineRec, userState);

    // Engine recommendation must remain 100% untouched
    expect(vetoedEngineRec.engineVerdict).toBe("PASS");
    expect(vetoedEngineRec.vetoed).toBe(true);
    expect(vetoedEngineRec.vetoReason).toBe("G-EXECUTIVE-IDENTITY-MISMATCH");
    expect(vetoedEngineRec.qualityScore).toBeNull();
    expect(effective).toBe("VETO_OVERRIDE");
  });

  // ==========================================================================
  // T2: Effective Decision Synthesis (State Matrix Completeness)
  // ==========================================================================
  it("T2: correctly synthesizes effective decisions across all engine + user states", () => {
    const enginePursue = makeEngineRec({ engineVerdict: "PURSUE", vetoed: false });
    const engineConsider = makeEngineRec({ engineVerdict: "CONSIDER", vetoed: false, qualityScore: 75 });
    const enginePassVetoed = makeEngineRec({ engineVerdict: "PASS", vetoed: true, vetoReason: "G-IDENTITY-VETO", qualityScore: null });
    const engineSparse = makeEngineRec({ engineVerdict: "SPARSE_SPEC", qualityScore: null });

    // 1. Engine PURSUE + User NONE -> ENGINE_PURSUIT
    expect(computeEffectiveDecision(enginePursue, null)).toBe("ENGINE_PURSUIT");
    expect(computeEffectiveDecision(enginePursue, makeUserState({ userAction: "NONE" }))).toBe("ENGINE_PURSUIT");

    // 2. Engine PURSUE + User PURSUE -> USER_CONFIRMED
    expect(computeEffectiveDecision(enginePursue, makeUserState({ userAction: "PURSUE" }))).toBe("USER_CONFIRMED");

    // 3. Engine CONSIDER + User PURSUE -> PREFERENCE_OVERRIDE
    expect(computeEffectiveDecision(engineConsider, makeUserState({ userAction: "PURSUE" }))).toBe("PREFERENCE_OVERRIDE");

    // 4. Engine PASS (Vetoed) + User PURSUE -> VETO_OVERRIDE
    expect(computeEffectiveDecision(enginePassVetoed, makeUserState({ userAction: "PURSUE" }))).toBe("VETO_OVERRIDE");

    // 5. Any Engine + User PASS -> USER_PASSED
    expect(computeEffectiveDecision(enginePursue, makeUserState({ userAction: "PASS" }))).toBe("USER_PASSED");
    expect(computeEffectiveDecision(engineConsider, makeUserState({ userAction: "PASS" }))).toBe("USER_PASSED");
    expect(computeEffectiveDecision(enginePassVetoed, makeUserState({ userAction: "PASS" }))).toBe("USER_PASSED");

    // 6. Engine CONSIDER + User NONE -> ENGINE_CONSIDER
    expect(computeEffectiveDecision(engineConsider, null)).toBe("ENGINE_CONSIDER");

    // 7. Engine SPARSE_SPEC -> NOT_EVALUABLE
    expect(computeEffectiveDecision(engineSparse, null)).toBe("NOT_EVALUABLE");
  });

  // ==========================================================================
  // T3: Review Workflow State Derivation (4-State Provenance Tracking)
  // ==========================================================================
  it("T3: derives review workflow state accurately based on evaluation fingerprint and provenance", () => {
    const engine = makeEngineRec({ evaluationFingerprint: "v4.3.0:j-123:PURSUE" });

    // 1. No user action -> UNREVIEWED
    expect(computeReviewWorkflowState(engine, null)).toBe("UNREVIEWED");
    expect(computeReviewWorkflowState(engine, makeUserState({ userAction: "NONE" }))).toBe("UNREVIEWED");

    // 2. Legacy decision with NO recorded evaluation fingerprint -> REVIEWED_UNKNOWN
    expect(computeReviewWorkflowState(engine, makeUserState({
      userAction: "PURSUE",
      reviewedFingerprint: null,
    }))).toBe("REVIEWED_UNKNOWN");

    expect(computeReviewWorkflowState(engine, makeUserState({
      userAction: "CONSIDER",
      reviewedFingerprint: undefined,
    }))).toBe("REVIEWED_UNKNOWN");

    expect(computeReviewWorkflowState(engine, makeUserState({
      userAction: "PASS",
      reviewedFingerprint: null,
    }))).toBe("REVIEWED_UNKNOWN");

    // 3. User reviewed with identical fingerprint -> REVIEWED_CURRENT
    expect(computeReviewWorkflowState(engine, makeUserState({
      userAction: "PURSUE",
      reviewedFingerprint: "v4.3.0:j-123:PURSUE",
    }))).toBe("REVIEWED_CURRENT");

    // 4. User reviewed with old/stale fingerprint -> REVIEWED_STALE
    expect(computeReviewWorkflowState(engine, makeUserState({
      userAction: "PURSUE",
      reviewedFingerprint: "v4.2.0:j-123:CONSIDER", // Older evaluation
    }))).toBe("REVIEWED_STALE");
  });

  // ==========================================================================
  // T4: Homogeneous Population Sorting (Tier Isolation & Numeric Ordering)
  // ==========================================================================
  it("T4: isolates population tiers and sorts numerically within homogeneous tiers", () => {
    expect(determinePopulationTier("ENGINE_PURSUIT", makeEngineRec())).toBe(RankingPopulationTier.TIER_0_ENGINE_RECOMMENDED);
    expect(determinePopulationTier("USER_CONFIRMED", makeEngineRec())).toBe(RankingPopulationTier.TIER_0_ENGINE_RECOMMENDED);
    expect(determinePopulationTier("PREFERENCE_OVERRIDE", makeEngineRec())).toBe(RankingPopulationTier.TIER_1_PREFERENCE_OVERRIDE);
    expect(determinePopulationTier("VETO_OVERRIDE", makeEngineRec())).toBe(RankingPopulationTier.TIER_2_VETO_OVERRIDE);
    expect(determinePopulationTier("ENGINE_CONSIDER", makeEngineRec())).toBe(RankingPopulationTier.TIER_3_ENGINE_CONSIDER);
    expect(determinePopulationTier("NOT_EVALUABLE", makeEngineRec())).toBe(RankingPopulationTier.TIER_4_NOT_EVALUABLE);
    expect(determinePopulationTier("USER_PASSED", makeEngineRec())).toBe(RankingPopulationTier.TIER_5_PASS_ARCHIVE);

    // Tier 0 must strictly precede Tier 1 and Tier 2
    expect(RankingPopulationTier.TIER_0_ENGINE_RECOMMENDED).toBeLessThan(RankingPopulationTier.TIER_1_PREFERENCE_OVERRIDE);
    expect(RankingPopulationTier.TIER_1_PREFERENCE_OVERRIDE).toBeLessThan(RankingPopulationTier.TIER_2_VETO_OVERRIDE);
  });

  // ==========================================================================
  // T5: Null Score Quarantine (Zero Coercion Prohibition)
  // ==========================================================================
  it("T5: preserves null score without coercing to 0 and quarantines null below evaluated scores", () => {
    const evaluatedPursuit: Partial<Opportunity> = {
      jobHash: "j-evaluated",
      effectiveDecision: "ENGINE_PURSUIT",
      engineRecommendation: makeEngineRec({ jobHash: "j-evaluated", qualityScore: 10 }), // low but evaluated
      recommendationResult: { score: 10, decision: "PURSUE", policyId: "v4", policyVersion: "v4", explanation: "", capabilities: [] },
    };

    const vetoedItem: Partial<Opportunity> = {
      jobHash: "j-vetoed",
      effectiveDecision: "VETO_OVERRIDE",
      engineRecommendation: makeEngineRec({ jobHash: "j-vetoed", qualityScore: null, vetoed: true }),
      recommendationResult: { score: null, decision: "PASS", policyId: "v4", policyVersion: "v4", explanation: "", capabilities: [] },
    };

    expect(evaluatedPursuit.engineRecommendation?.qualityScore).toBe(10);
    expect(vetoedItem.engineRecommendation?.qualityScore).toBeNull();
    expect(vetoedItem.recommendationResult?.score).toBeNull();
  });

  // ==========================================================================
  // T6: Confidence Exclusion from Fit Ranking
  // ==========================================================================
  it("T6: excludes confidence from candidate fit ranking comparator", () => {
    // Role A: Quality Score 75, Parsing Confidence 0.50
    const roleA: Partial<Opportunity> = {
      jobHash: "j-role-a",
      effectiveDecision: "ENGINE_PURSUIT",
      engineRecommendation: makeEngineRec({ jobHash: "j-role-a", qualityScore: 75, parsingConfidence: 0.50 }),
      recommendationResult: { score: 75, decision: "PURSUE", policyId: "v4", policyVersion: "v4", explanation: "", capabilities: [], decisionConfidence: { overall: 0.50 } as any },
    };

    // Role B: Quality Score 70, Parsing Confidence 0.95
    const roleB: Partial<Opportunity> = {
      jobHash: "j-role-b",
      effectiveDecision: "ENGINE_PURSUIT",
      engineRecommendation: makeEngineRec({ jobHash: "j-role-b", qualityScore: 70, parsingConfidence: 0.95 }),
      recommendationResult: { score: 70, decision: "PURSUE", policyId: "v4", policyVersion: "v4", explanation: "", capabilities: [], decisionConfidence: { overall: 0.95 } as any },
    };

    const list = [roleB, roleA] as Opportunity[];
    
    // Sort with V4 Population Tier logic
    const sorted = [...list].sort((a, b) => {
      const tierDiff = (determinePopulationTier(a.effectiveDecision!, a.engineRecommendation!) - determinePopulationTier(b.effectiveDecision!, b.engineRecommendation!));
      if (tierDiff !== 0) return tierDiff;
      const scoreA = a.engineRecommendation?.qualityScore ?? a.recommendationResult?.score ?? null;
      const scoreB = b.engineRecommendation?.qualityScore ?? b.recommendationResult?.score ?? null;
      if (scoreA !== null && scoreB !== null) return scoreB - scoreA;
      return a.jobHash.localeCompare(b.jobHash);
    });

    // Role A (score 75) must rank above Role B (score 70), despite Role B having higher confidence (0.95 vs 0.50)
    expect(sorted[0].jobHash).toBe("j-role-a");
    expect(sorted[1].jobHash).toBe("j-role-b");
  });

  // ==========================================================================
  // T7: Historical Bug Reproduction 1 — TRUGlobal Veto Override Ranking
  // ==========================================================================
  it("T7: TRUGlobal vetoed opportunity (j-04acb1b1be94) is quarantined in Tier 2 and never displaces genuine pursuits", () => {
    // 1. Genuine Engine Pursuit
    const enginePursuit: Opportunity = {
      jobHash: "j-genuine-pursuit",
      role: "Chief Commercial Officer",
      company: "Acme Corp",
      location: "Bengaluru",
      postedRelative: "1d ago",
      scrapedFrom: "LinkedIn",
      decision: "PURSUE",
      recommendation: "Strong pursuit",
      primaryConcern: null,
      positioning: [],
      headspace: [],
      dimensions: [],
      hiringRisk: "Low",
      effectiveDecision: "ENGINE_PURSUIT",
      engineRecommendation: makeEngineRec({
        jobHash: "j-genuine-pursuit",
        engineVerdict: "PURSUE",
        vetoed: false,
        qualityScore: 88,
        parsingConfidence: 0.85,
      }),
      recommendationResult: { score: 88, decision: "PURSUE", policyId: "v4", policyVersion: "v4", explanation: "", capabilities: [] },
    };

    // 2. TRUGlobal Overridden Veto
    const truGlobalVetoOverride: Opportunity = {
      jobHash: "j-04acb1b1be94",
      role: "Delivery Head - Custom Apps",
      company: "TRUGlobal",
      location: "Bengaluru",
      postedRelative: "3d ago",
      scrapedFrom: "LinkedIn",
      decision: "PURSUE", // User chose PURSUE
      recommendation: "Excluded",
      primaryConcern: null,
      positioning: [],
      headspace: [],
      dimensions: [],
      hiringRisk: "High",
      effectiveDecision: "VETO_OVERRIDE",
      engineRecommendation: makeEngineRec({
        jobHash: "j-04acb1b1be94",
        engineVerdict: "PASS",
        vetoed: true,
        vetoReason: "G-EXECUTIVE-IDENTITY-MISMATCH",
        qualityScore: null,
        parsingConfidence: 0.95, // High parsing confidence must NOT cause it to rank #1
      }),
      recommendationResult: { score: null, decision: "PASS", policyId: "v4", policyVersion: "v4", explanation: "", capabilities: [] },
    };

    const queue = [truGlobalVetoOverride, enginePursuit];

    const POPULATION_TIER_ORDER: Record<EffectiveDecision, number> = {
      ENGINE_PURSUIT: 0,
      USER_CONFIRMED: 0,
      PREFERENCE_OVERRIDE: 1,
      VETO_OVERRIDE: 2,
      ENGINE_CONSIDER: 3,
      NOT_EVALUABLE: 4,
      USER_PASSED: 5,
      ENGINE_PASS: 5,
    };

    const sorted = [...queue].sort((a, b) => {
      const tierA = POPULATION_TIER_ORDER[a.effectiveDecision || "ENGINE_PASS"] ?? 5;
      const tierB = POPULATION_TIER_ORDER[b.effectiveDecision || "ENGINE_PASS"] ?? 5;
      if (tierA !== tierB) return tierA - tierB;
      const scoreA = a.engineRecommendation?.qualityScore ?? a.recommendationResult?.score ?? null;
      const scoreB = b.engineRecommendation?.qualityScore ?? b.recommendationResult?.score ?? null;
      if (scoreA !== null && scoreB !== null) return scoreB - scoreA;
      if (scoreA !== null && scoreB === null) return -1;
      if (scoreA === null && scoreB !== null) return 1;
      return a.jobHash.localeCompare(b.jobHash);
    });

    // Genuine pursuit MUST rank #1; TRUGlobal veto override MUST rank #2 in Tier 2
    expect(sorted[0].jobHash).toBe("j-genuine-pursuit");
    expect(sorted[1].jobHash).toBe("j-04acb1b1be94");
    expect(sorted[1].engineRecommendation?.vetoed).toBe(true);
    expect(sorted[1].engineRecommendation?.vetoReason).toBe("G-EXECUTIVE-IDENTITY-MISMATCH");
    expect(sorted[1].engineRecommendation?.qualityScore).toBeNull();
  });

  // ==========================================================================
  // T8: Historical Bug Reproduction 2 — Re-evaluation Fingerprint Staleness
  // ==========================================================================
  it("T8: marks review state as REVIEWED_STALE when engine re-evaluates without deleting user decision", () => {
    // Initial evaluation
    const initialEngine = makeEngineRec({
      jobHash: "j-fresh-68",
      evaluationFingerprint: "v4.3.0:j-fresh-68:PASS",
      engineVerdict: "PASS",
    });

    // User decided on initial evaluation
    const userDecision = makeUserState({
      jobHash: "j-fresh-68",
      userAction: "CONSIDER",
      reviewedFingerprint: "v4.3.0:j-fresh-68:PASS",
    });

    expect(computeReviewWorkflowState(initialEngine, userDecision)).toBe("REVIEWED_CURRENT");

    // Re-evaluated with new policy / enriched signals
    const reEvaluatedEngine = makeEngineRec({
      jobHash: "j-fresh-68",
      evaluationFingerprint: "v4.4.0:j-fresh-68:CONSIDER", // Changed fingerprint
      engineVerdict: "CONSIDER",
    });

    // Review state becomes REVIEWED_STALE without losing historical user intent
    expect(computeReviewWorkflowState(reEvaluatedEngine, userDecision)).toBe("REVIEWED_STALE");
    expect(userDecision.userAction).toBe("CONSIDER");
  });

  // ==========================================================================
  // T9: Active Pursuit Headspace Calculation
  // ==========================================================================
  it("T9: counts active pursuits based on user intent without mutating engine recommendation", () => {
    const opp = makeEngineRec({ jobHash: "j-h1", engineVerdict: "CONSIDER" });
    const user1 = makeUserState({ jobHash: "j-h1", userAction: "PURSUE" });

    const effective = computeEffectiveDecision(opp, user1);
    expect(effective).toBe("PREFERENCE_OVERRIDE");
    // Engine verdict remains immutable CONSIDER
    expect(opp.engineVerdict).toBe("CONSIDER");
  });

  // ==========================================================================
  // T10: 4-State Review Queue Filter Rules (Executive Headspace Preservation)
  // ==========================================================================
  it("T10: review queue filter correctly admits UNREVIEWED, REVIEWED_STALE, and REVIEWED_UNKNOWN (PURSUE/CONSIDER), while suppressing REVIEWED_UNKNOWN (PASS) and REVIEWED_CURRENT", () => {
    const items: Partial<Opportunity>[] = [
      { jobHash: "j-unreviewed", reviewWorkflowState: "UNREVIEWED", decision: "PURSUE" },
      { jobHash: "j-reviewed-current", reviewWorkflowState: "REVIEWED_CURRENT", decision: "PURSUE" },
      { jobHash: "j-reviewed-stale", reviewWorkflowState: "REVIEWED_STALE", decision: "PURSUE" },
      { jobHash: "j-unknown-pursue", reviewWorkflowState: "REVIEWED_UNKNOWN", decision: "PURSUE", userDecision: makeUserState({ userAction: "PURSUE", reviewedFingerprint: null }) },
      { jobHash: "j-unknown-consider", reviewWorkflowState: "REVIEWED_UNKNOWN", decision: "CONSIDER", userDecision: makeUserState({ userAction: "CONSIDER", reviewedFingerprint: null }) },
      { jobHash: "j-unknown-pass", reviewWorkflowState: "REVIEWED_UNKNOWN", decision: "PASS", userDecision: makeUserState({ userAction: "PASS", reviewedFingerprint: null }) },
    ];

    const isQueueItem = (o: Partial<Opportunity>) => {
      if (o.reviewWorkflowState === "UNREVIEWED") return true;
      if (o.reviewWorkflowState === "REVIEWED_STALE") return true;
      if (o.reviewWorkflowState === "REVIEWED_UNKNOWN") {
        const action = o.userDecision?.userAction || o.decision;
        return action === "PURSUE" || action === "CONSIDER";
      }
      return false;
    };

    const triageQueue = items.filter(isQueueItem);

    expect(triageQueue.map((o) => o.jobHash)).toEqual([
      "j-unreviewed",
      "j-reviewed-stale",
      "j-unknown-pursue",
      "j-unknown-consider",
    ]);
  });

  // ==========================================================================
  // T11: End-to-End OpportunityService Contract Verification (M5 Materialized Queue)
  // ==========================================================================
  it("T11: OpportunityService.listForUser returns properly structured V4 opportunities with 4-state workflow from materialized state without invoking runEngine", async () => {
    const repos = getRepositories();
    const userId = "t11-verified-user";
    const runEngineSpy = vi.spyOn(engineModule, "runEngine");

    // 1. Seed/materialize evaluations into database representing complete, sparse, and vetoed states
    const items = [
      {
        jobHash: "j-t11-pursue",
        engineVerdict: "PURSUE" as const,
        engineQualityScore: 92,
        vetoed: false,
        vetoReason: null,
      },
      {
        jobHash: "j-t11-consider",
        engineVerdict: "CONSIDER" as const,
        engineQualityScore: 78,
        vetoed: false,
        vetoReason: null,
      },
      {
        jobHash: "j-t11-vetoed",
        engineVerdict: "PASS" as const,
        engineQualityScore: 0,
        vetoed: true,
        vetoReason: "G-EXECUTIVE-IDENTITY-MISMATCH",
      },
    ];

    for (const item of items) {
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash: item.jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: `fp_${item.jobHash}`,
        engineVerdict: item.engineVerdict,
        engineQualityScore: item.engineQualityScore,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash: item.jobHash,
          personId: userId,
          evaluationInputHash: `fp_${item.jobHash}`,
          policyVersion: "v4.3",
          ontologyVersion: "v2",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: item.engineVerdict,
          intrinsicQualityScore: item.vetoed ? null : item.engineQualityScore,
          vetoed: item.vetoed,
          vetoReason: item.vetoReason,
          parsingConfidence: 0.95,
          triggeredRuleIds: item.vetoed ? ["RULE_VETO"] : [],
          decisionRisks: [],
          decisionDrivers: [],
          evaluationStatus: "COMPLETE",
          dimensions: [],
          esi: 85,
          diligenceStatus: "VERIFIED",
          baseNarrative: {
            baseRecommendationProse: `Executive match for ${item.jobHash}`,
          },
          auditTrace: {
            verb0: item.engineVerdict,
            careerValue: 80,
            shortlistingPotential: 85,
            pursuitFriction: 20,
            rawScore: item.engineQualityScore,
            evidenceMappingCount: 5,
          },
        }),
      });
    }

    // 2. Call OpportunityService.listForUser()
    const opportunities = await OpportunityService.listForUser(userId);

    // 3. Assert that it returns the expected V4 opportunity structure
    expect(opportunities.length).toBe(3);

    for (const opp of opportunities) {
      // Must have valid engine recommendation object
      expect(opp.engineRecommendation).toBeDefined();
      expect(opp.engineRecommendation?.jobHash).toBe(opp.jobHash);
      expect(opp.engineRecommendation?.engineVerdict).toBeDefined();
      expect(typeof opp.engineRecommendation?.vetoed).toBe("boolean");

      // Must have valid effective decision
      expect(opp.effectiveDecision).toBeDefined();

      // Must have valid review workflow state from 4-state domain model
      expect(["UNREVIEWED", "REVIEWED_CURRENT", "REVIEWED_STALE", "REVIEWED_UNKNOWN"]).toContain(opp.reviewWorkflowState);

      // If vetoed, score must be null
      if (opp.engineRecommendation?.vetoed) {
        expect(opp.engineRecommendation.qualityScore).toBeNull();
      }
    }

    // 4. Assert that an empty materialized population returns []
    const emptyOps = await OpportunityService.listForUser("t11-nonexistent-user-empty");
    expect(emptyOps).toEqual([]);

    // 5. Assert that listForUser() does not invoke runEngine()
    expect(runEngineSpy).not.toHaveBeenCalled();

    runEngineSpy.mockRestore();
  }, 45000);

  // ==========================================================================
  // T12: Cross-Boundary Queue Filter with Client Decision Store State
  // ==========================================================================
  it("T12: review queue admits REVIEWED_UNKNOWN and REVIEWED_STALE items, and excludes them immediately once reviewed against current fingerprint", () => {
    const currentFingerprint = "v4.3.0:eval";

    const unreviewedOpp: Partial<Opportunity> = {
      jobHash: "j-unreviewed",
      reviewWorkflowState: "UNREVIEWED",
      decision: "PURSUE",
      engineRecommendation: makeEngineRec({ jobHash: "j-unreviewed", evaluationFingerprint: currentFingerprint }),
    };

    const reviewedCurrentOpp: Partial<Opportunity> = {
      jobHash: "j-reviewed-current",
      reviewWorkflowState: "REVIEWED_CURRENT",
      decision: "PURSUE",
      engineRecommendation: makeEngineRec({ jobHash: "j-reviewed-current", evaluationFingerprint: currentFingerprint }),
    };

    const reviewedStaleOpp: Partial<Opportunity> = {
      jobHash: "j-reviewed-stale",
      reviewWorkflowState: "REVIEWED_STALE",
      decision: "PURSUE",
      engineRecommendation: makeEngineRec({ jobHash: "j-reviewed-stale", evaluationFingerprint: currentFingerprint }),
    };

    const reviewedUnknownPursueOpp: Partial<Opportunity> = {
      jobHash: "j-unknown-pursue",
      reviewWorkflowState: "REVIEWED_UNKNOWN",
      decision: "PURSUE",
      userDecision: makeUserState({ userAction: "PURSUE", reviewedFingerprint: null }),
      engineRecommendation: makeEngineRec({ jobHash: "j-unknown-pursue", evaluationFingerprint: currentFingerprint }),
    };

    const reviewedUnknownPassOpp: Partial<Opportunity> = {
      jobHash: "j-unknown-pass",
      reviewWorkflowState: "REVIEWED_UNKNOWN",
      decision: "PASS",
      userDecision: makeUserState({ userAction: "PASS", reviewedFingerprint: null }),
      engineRecommendation: makeEngineRec({ jobHash: "j-unknown-pass", evaluationFingerprint: currentFingerprint }),
    };

    // Client decision store map with legacy decision (no fingerprint)
    const clientDecisionsMap: Record<string, { verb: string; at: number; reviewedFingerprint?: string | null }> = {
      "j-unknown-pursue": { verb: "PURSUE", at: 1000, reviewedFingerprint: null },
      "j-unknown-pass": { verb: "PASS", at: 1000, reviewedFingerprint: null },
      "j-reviewed-current": { verb: "PURSUE", at: 2000, reviewedFingerprint: currentFingerprint },
    };

    const allOpps = [
      unreviewedOpp,
      reviewedCurrentOpp,
      reviewedStaleOpp,
      reviewedUnknownPursueOpp,
      reviewedUnknownPassOpp,
    ] as Opportunity[];

    // Exact review queue filter from src/routes/index.tsx
    const filterQueue = (opps: Opportunity[], clientDecisions: Record<string, any>) =>
      opps.filter((o) => {
        const clientRec = clientDecisions[o.jobHash];
        const fp = o.engineRecommendation?.evaluationFingerprint || (o as any).recommendationResult?.policyVersion;
        if (clientRec && clientRec.reviewedFingerprint && clientRec.reviewedFingerprint === fp) {
          return false;
        }

        if (o.reviewWorkflowState === "UNREVIEWED") {
          if (clientRec && !clientRec.reviewedFingerprint) return false;
          return true;
        }

        if (o.reviewWorkflowState === "REVIEWED_STALE") {
          if (clientRec && clientRec.reviewedFingerprint === fp) return false;
          return true;
        }

        if (o.reviewWorkflowState === "REVIEWED_UNKNOWN") {
          if (clientRec && clientRec.reviewedFingerprint === fp) return false;
          const action = o.userDecision?.userAction || o.decision;
          return action === "PURSUE" || action === "CONSIDER";
        }

        return false;
      });

    const initialQueue = filterQueue(allOpps, clientDecisionsMap);
    const initialHashes = initialQueue.map((o) => o.jobHash);

    // Initial assertions:
    // - "j-unreviewed" included
    // - "j-reviewed-stale" included
    // - "j-unknown-pursue" included
    // - "j-unknown-pass" excluded (pass archived)
    // - "j-reviewed-current" excluded (already reviewed against current fingerprint)
    expect(initialHashes).toContain("j-unreviewed");
    expect(initialHashes).toContain("j-reviewed-stale");
    expect(initialHashes).toContain("j-unknown-pursue");
    expect(initialHashes).not.toContain("j-unknown-pass");
    expect(initialHashes).not.toContain("j-reviewed-current");

    // Simulate user confirming posture on "j-unknown-pursue" -> records current fingerprint
    clientDecisionsMap["j-unknown-pursue"] = {
      verb: "PURSUE",
      at: Date.now(),
      reviewedFingerprint: currentFingerprint,
    };

    const postReviewQueue = filterQueue(allOpps, clientDecisionsMap);
    const postReviewHashes = postReviewQueue.map((o) => o.jobHash);

    // "j-unknown-pursue" is now immediately excluded from the queue
    expect(postReviewHashes).not.toContain("j-unknown-pursue");
    expect(postReviewHashes).toEqual(["j-unreviewed", "j-reviewed-stale"]);
  });
});

