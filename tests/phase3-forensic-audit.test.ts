import { describe, it, expect } from "vitest";
import { runEngine } from "../src/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import { SqliteEvaluationStore } from "../src/data/sqlite/repositories/SqliteEvaluationStore";
import {
  computeEffectiveDecision,
  computeReviewWorkflowState,
  type EngineRecommendationV4,
  type UserDecisionStateV4,
} from "../src/domain/decision_v4";
import { buildHeadspace } from "../src/lib/intelligence/candidate";
import { applyHeadspaceFilter } from "../src/lib/intelligence/headspace-filter";

describe("Phase 3 Forensic Audit Unit & Invariant Tests", () => {
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(candidateProfile);

  it("1. Determinism Proof: runEngine() executed twice with identical inputs produces bit-identical records", () => {
    const run1 = runEngine(projection, 0);
    const run2 = runEngine(projection, 0);

    expect(run1.records.length).toBe(run2.records.length);
    expect(run1.records.length).toBeGreaterThan(0);

    for (let i = 0; i < run1.records.length; i++) {
      const r1 = run1.records[i];
      const r2 = run2.records[i];

      expect(r1.jobHash).toBe(r2.jobHash);
      expect(r1.verb).toBe(r2.verb);
      expect(r1.qualityScore).toBe(r2.qualityScore);
      expect(r1.rawScore).toBe(r2.rawScore);
      expect(r1.vetoed).toBe(r2.vetoed);
      expect(r1.trace?.verb0).toBe(r2.trace?.verb0);
      expect(r1.trace?.finalVerb).toBe(r2.trace?.finalVerb);
      expect(r1.trace?.factors?.shortlistingPotential).toBe(r2.trace?.factors?.shortlistingPotential);
    }
  });

  it("2. Attention Window Forensic 4x4 Truth Table Verification", () => {
    // 4x4 matrix: attentionWindow [1, 3, 6, 10] vs activePursuits [0, 3, 6, 10]
    const attentionWindows = [1, 3, 6, 10];
    const activePursuitCounts = [0, 3, 6, 10];

    for (const win of attentionWindows) {
      for (const active of activePursuitCounts) {
        const hs = buildHeadspace(active, win);
        const expectedSaturated = active >= win;
        expect(hs.saturated).toBe(expectedSaturated);
        expect(hs.capacityPerMonth).toBe(win);
        expect(hs.activePursuits).toBe(active);

        // Test filter outcome on PURSUE verb
        const outcome = applyHeadspaceFilter("PURSUE", hs);
        if (expectedSaturated) {
          expect(outcome.finalVerb).toBe("CONSIDER");
          expect(outcome.downgraded).toBe(true);
          expect(outcome.reason).toBeDefined();
        } else {
          expect(outcome.finalVerb).toBe("PURSUE");
          expect(outcome.downgraded).toBe(false);
        }

        // Test filter outcome on CONSIDER verb (should remain CONSIDER, never downgraded)
        const outcomeConsider = applyHeadspaceFilter("CONSIDER", hs);
        expect(outcomeConsider.finalVerb).toBe("CONSIDER");
        expect(outcomeConsider.downgraded).toBe(false);

        // Test filter outcome on PASS verb (should remain PASS, never downgraded)
        const outcomePass = applyHeadspaceFilter("PASS", hs);
        expect(outcomePass.finalVerb).toBe("PASS");
        expect(outcomePass.downgraded).toBe(false);
      }
    }
  });

  it("3. Hash / Fingerprint Forensics: computeInputHash determinism and component sensitivity", () => {
    const hash1 = SqliteEvaluationStore.computeInputHash("prof_v1", "job_123", "policy_v4", "v2");
    const hash2 = SqliteEvaluationStore.computeInputHash("prof_v1", "job_123", "policy_v4", "v2");
    expect(hash1).toBe(hash2);

    const hashDiffProfile = SqliteEvaluationStore.computeInputHash("prof_v2", "job_123", "policy_v4", "v2");
    expect(hashDiffProfile).not.toBe(hash1);

    const hashDiffJob = SqliteEvaluationStore.computeInputHash("prof_v1", "job_456", "policy_v4", "v2");
    expect(hashDiffJob).not.toBe(hash1);

    const hashDiffPolicy = SqliteEvaluationStore.computeInputHash("prof_v1", "job_123", "policy_v5", "v2");
    expect(hashDiffPolicy).not.toBe(hash1);

    const hashDiffOntology = SqliteEvaluationStore.computeInputHash("prof_v1", "job_123", "policy_v4", "v3");
    expect(hashDiffOntology).not.toBe(hash1);
  });

  it("4. Multi-State Decision Model: computeEffectiveDecision preserves independent truths", () => {
    const engineRec: EngineRecommendationV4 = {
      jobHash: "job_1",
      evaluationFingerprint: "fp_1",
      engineVerdict: "PURSUE",
      vetoed: false,
      vetoReason: null,
      qualityScore: 92,
      parsingConfidence: 0.95,
      evaluatedAt: new Date().toISOString(),
    };

    // Unreviewed
    expect(computeEffectiveDecision(engineRec, null)).toBe("ENGINE_PURSUIT");

    // User confirms PURSUE
    const userPursue: UserDecisionStateV4 = { personId: "p1", jobHash: "job_1", userAction: "PURSUE" };
    expect(computeEffectiveDecision(engineRec, userPursue)).toBe("USER_CONFIRMED");

    // User PASS
    const userPass: UserDecisionStateV4 = { personId: "p1", jobHash: "job_1", userAction: "PASS" };
    expect(computeEffectiveDecision(engineRec, userPass)).toBe("USER_PASSED");

    // Engine PASS + User PURSUE
    const enginePass: EngineRecommendationV4 = { ...engineRec, engineVerdict: "PASS", vetoed: true, vetoReason: "Domain mismatch" };
    expect(computeEffectiveDecision(enginePass, userPursue)).toBe("VETO_OVERRIDE");

    // Engine CONSIDER + User PURSUE
    const engineConsider: EngineRecommendationV4 = { ...engineRec, engineVerdict: "CONSIDER" };
    expect(computeEffectiveDecision(engineConsider, userPursue)).toBe("PREFERENCE_OVERRIDE");
  });

  it("5. Review Workflow State Invariants", () => {
    const engineRec: EngineRecommendationV4 = {
      jobHash: "job_1",
      evaluationFingerprint: "fp_version_1",
      engineVerdict: "PURSUE",
      vetoed: false,
      vetoReason: null,
      qualityScore: 90,
      parsingConfidence: 0.9,
      evaluatedAt: new Date().toISOString(),
    };

    // No action
    expect(computeReviewWorkflowState(engineRec, null)).toBe("UNREVIEWED");

    // Legacy action without fingerprint
    const legacyUser: UserDecisionStateV4 = { personId: "p1", jobHash: "job_1", userAction: "PURSUE" };
    expect(computeReviewWorkflowState(engineRec, legacyUser)).toBe("REVIEWED_UNKNOWN");

    // Matching fingerprint
    const currentUser: UserDecisionStateV4 = { personId: "p1", jobHash: "job_1", userAction: "PURSUE", reviewedFingerprint: "fp_version_1" };
    expect(computeReviewWorkflowState(engineRec, currentUser)).toBe("REVIEWED_CURRENT");

    // Stale fingerprint
    const staleUser: UserDecisionStateV4 = { personId: "p1", jobHash: "job_1", userAction: "PURSUE", reviewedFingerprint: "fp_version_old" };
    expect(computeReviewWorkflowState(engineRec, staleUser)).toBe("REVIEWED_STALE");
  });
});
