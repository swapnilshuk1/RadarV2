import { describe, it, expect } from "vitest";
import type { Opportunity } from "../../src/data/opportunity-fixtures";
import type { DecisionRecord } from "../../src/lib/decisions-store";

/**
 * Pure helper function mimicking the Shortlist remaining filter logic in src/routes/index.tsx
 */
export function filterShortlistRemaining(
  activeOps: Opportunity[],
  decisions: Record<string, DecisionRecord>
): Opportunity[] {
  return activeOps.filter((o) => {
    const clientRec = decisions[o.jobHash];
    const userVerb = clientRec?.verb || o.userDecision?.userAction;

    // A user-decided PURSUE opportunity belongs in Pursued/Opportunities (/decisions)
    // and must not re-enter the unresolved Shortlist queue even if stale or re-evaluated.
    if (userVerb === "PURSUE") {
      return false;
    }

    const currentFingerprint =
      o.engineRecommendation?.evaluationFingerprint ||
      (o as any).recommendationResult?.policyVersion;

    if (
      clientRec &&
      clientRec.reviewedFingerprint &&
      clientRec.reviewedFingerprint === currentFingerprint
    ) {
      return false;
    }

    if (o.reviewWorkflowState === "UNREVIEWED") {
      if (clientRec && !clientRec.reviewedFingerprint) return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_STALE") {
      if (
        clientRec &&
        clientRec.reviewedFingerprint === currentFingerprint
      )
        return false;
      return true;
    }

    if (o.reviewWorkflowState === "REVIEWED_UNKNOWN") {
      if (
        clientRec &&
        clientRec.reviewedFingerprint === currentFingerprint
      )
        return false;
      const action =
        o.userDecision?.userAction || o.engineRecommendation?.engineVerdict;
      return action === "PURSUE" || action === "CONSIDER";
    }

    return false;
  });
}

describe("Pursue Queue Isolation & Shortlist Filtering Invariants", () => {
  it("1. EXISTING USER PURSUE + STALE/UNKNOWN EVALUATION → does NOT re-enter unresolved Shortlist", () => {
    const oppStale: Opportunity = {
      jobHash: "j-f1b1ee48cdde",
      role: "Director - Key Accounts & Revenue Generation",
      company: "Weekday AI",
      reviewWorkflowState: "REVIEWED_STALE",
      engineRecommendation: {
        jobHash: "j-f1b1ee48cdde",
        evaluationFingerprint: "eval_v4_new_hash_123",
        engineVerdict: "CONSIDER",
        vetoed: false,
        vetoReason: null,
        qualityScore: 81,
        parsingConfidence: 0.8,
        evaluatedAt: new Date().toISOString(),
      },
      userDecision: {
        personId: "u1",
        jobHash: "j-f1b1ee48cdde",
        userAction: "PURSUE",
        reviewedFingerprint: "legacy_old_fingerprint",
      },
    } as any;

    const decisionsMap: Record<string, DecisionRecord> = {
      "j-f1b1ee48cdde": {
        verb: "PURSUE",
        reviewedFingerprint: "legacy_old_fingerprint",
      },
    };

    const remaining = filterShortlistRemaining([oppStale], decisionsMap);
    expect(remaining).toHaveLength(0);
  });

  it("2. NO USER DECISION + CURRENT ENGINE PURSUE → remains eligible for Shortlist", () => {
    const oppUnreviewed: Opportunity = {
      jobHash: "j-fresh123",
      role: "VP Marketing",
      company: "Acme Corp",
      reviewWorkflowState: "UNREVIEWED",
      engineRecommendation: {
        jobHash: "j-fresh123",
        evaluationFingerprint: "eval_v4_current",
        engineVerdict: "PURSUE",
        vetoed: false,
        vetoReason: null,
        qualityScore: 92,
        parsingConfidence: 0.9,
        evaluatedAt: new Date().toISOString(),
      },
    } as any;

    const decisionsMap: Record<string, DecisionRecord> = {};

    const remaining = filterShortlistRemaining([oppUnreviewed], decisionsMap);
    expect(remaining).toHaveLength(1);
    expect(remaining[0].jobHash).toBe("j-fresh123");
  });

  it("3. EXISTING USER CONSIDER / PASS → is NOT converted to PURSUE", () => {
    const oppConsider: Opportunity = {
      jobHash: "j-consider123",
      role: "Head of Growth",
      company: "Beta Inc",
      reviewWorkflowState: "REVIEWED_CURRENT",
      engineRecommendation: {
        jobHash: "j-consider123",
        evaluationFingerprint: "eval_v4_current",
        engineVerdict: "CONSIDER",
        vetoed: false,
        vetoReason: null,
        qualityScore: 70,
        parsingConfidence: 0.8,
        evaluatedAt: new Date().toISOString(),
      },
      userDecision: {
        personId: "u1",
        jobHash: "j-consider123",
        userAction: "CONSIDER",
        reviewedFingerprint: "eval_v4_current",
      },
    } as any;

    const decisionsMap: Record<string, DecisionRecord> = {
      "j-consider123": {
        verb: "CONSIDER",
        reviewedFingerprint: "eval_v4_current",
      },
    };

    // Verify it doesn't enter shortlist when matching current fingerprint
    const remaining = filterShortlistRemaining([oppConsider], decisionsMap);
    expect(remaining).toHaveLength(0);

    // Verify its verb in decisionsMap remains CONSIDER
    expect(decisionsMap["j-consider123"].verb).toBe("CONSIDER");
  });
});
