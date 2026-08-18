/**
 * P1-E: Ranking Determinism — Deterministic Tie-Breaking
 *
 * Acceptance Contract:
 * - Same score → higher confidence ranks first.
 * - Same score + same confidence → deterministic jobHash order.
 * - Input order reversal produces the same final ranking.
 * - Existing tier ordering remains unchanged.
 * - Existing score ordering remains unchanged.
 * - No score values are modified.
 * - No decision tiers are modified.
 *
 * This is an ENGINEERING DETERMINISM fix, NOT a scoring-policy change.
 */

import { describe, it, expect } from "vitest";
import type { Opportunity } from "@/data/opportunity-fixtures";
import type { DecisionConfidence } from "@/domain/entities";

// Helper to create test opportunities with specific properties
function createTestOpportunity(
  jobHash: string,
  decision: string,
  score: number,
  confidence: number,
  regressionScore?: number
): Opportunity {
  const decisionConfidence: DecisionConfidence = {
    confidence,
    factors: [],
    stability: "High",
    explanation: `Confidence ${confidence}`,
  };

  return {
    jobHash,
    role: "Test Role",
    company: "TestCo",
    location: "Test Location",
    postedRelative: "Posted today",
    scrapedFrom: "LinkedIn",
    decision: decision as any,
    recommendation: "Test recommendation",
    recommendationResult: {
      score,
      decision: decision as any,
      policyId: "policy-v4.3",
      policyVersion: "1.0.0",
      explanation: "Test explanation",
      capabilities: [],
      decisionConfidence,
    },
    dimensions: [],
    headspace: [],
    hiringRisk: "Test risk",
    // Include regressionScore in a way that survives through the type system
    ...(regressionScore !== undefined ? { esi: regressionScore } : {}),
  } as Opportunity;
}

// Replicate the sorting logic from opportunity-provider.ts
function sortOpportunities(opportunities: Opportunity[]): Opportunity[] {
  const decisionRank: Record<string, number> = { PURSUE: 0, CONSIDER: 1, PASS: 2 };

  return [...opportunities].sort((a, b) => {
    // P1-E: Deterministic tie-breaking for ranking
    // Primary: Decision tier (PURSUE < CONSIDER < PASS)
    const tierDiff = (decisionRank[a.decision] ?? 3) - (decisionRank[b.decision] ?? 3);
    if (tierDiff !== 0) return tierDiff;

    // Secondary: Higher recommendation score first
    const scoreA = a.recommendationResult?.score ?? 0;
    const scoreB = b.recommendationResult?.score ?? 0;
    const scoreDiff = scoreB - scoreA;
    if (scoreDiff !== 0) return scoreDiff;

    // Tertiary: Same score → higher confidence first
    const confA = a.recommendationResult?.decisionConfidence?.confidence ?? 0;
    const confB = b.recommendationResult?.decisionConfidence?.confidence ?? 0;
    const confDiff = confB - confA;
    if (confDiff !== 0) return confDiff;

    // Quaternary: Same confidence → deterministic jobHash order
    return a.jobHash.localeCompare(b.jobHash);
  });
}

describe("P1-E: Ranking Determinism", () => {
  it("E1: Same score → higher confidence ranks first", () => {
    const ops: Opportunity[] = [
      createTestOpportunity("opp-a", "CONSIDER", 65, 0.7),
      createTestOpportunity("opp-b", "CONSIDER", 65, 0.9),
      createTestOpportunity("opp-c", "CONSIDER", 65, 0.5),
    ];

    const sorted = sortOpportunities(ops);
    const hashes = sorted.map((o) => o.jobHash);

    // Higher confidence (0.9) should rank first
    expect(hashes[0]).toBe("opp-b"); // 0.9 confidence
    expect(hashes[1]).toBe("opp-a"); // 0.7 confidence
    expect(hashes[2]).toBe("opp-c"); // 0.5 confidence
  });

  it("E2: Same score + same confidence → deterministic jobHash order", () => {
    const ops: Opportunity[] = [
      createTestOpportunity("zebra", "CONSIDER", 65, 0.7),
      createTestOpportunity("alpha", "CONSIDER", 65, 0.7),
      createTestOpportunity("mango", "CONSIDER", 65, 0.7),
    ];

    const sorted = sortOpportunities(ops);
    const hashes = sorted.map((o) => o.jobHash);

    // Should be alphabetical by jobHash
    expect(hashes).toEqual(["alpha", "mango", "zebra"]);
  });

  it("E3: Input order reversal produces the same final ranking", () => {
    const ops: Opportunity[] = [
      createTestOpportunity("opp-c", "CONSIDER", 65, 0.5),
      createTestOpportunity("opp-a", "CONSIDER", 65, 0.7),
      createTestOpportunity("opp-b", "CONSIDER", 65, 0.9),
    ];

    const reversed = [...ops].reverse();
    const sortedOriginal = sortOpportunities(ops);
    const sortedReversed = sortOpportunities(reversed);

    const hashesOriginal = sortedOriginal.map((o) => o.jobHash);
    const hashesReversed = sortedReversed.map((o) => o.jobHash);

    // Same ranking regardless of input order
    expect(hashesOriginal).toEqual(hashesReversed);
    expect(hashesOriginal).toEqual(["opp-b", "opp-a", "opp-c"]);
  });

  it("E4: Existing tier ordering remains unchanged", () => {
    const ops: Opportunity[] = [
      createTestOpportunity("pass-high", "PASS", 95, 0.9),
      createTestOpportunity("consider-low", "CONSIDER", 61, 0.5),
      createTestOpportunity("pursue-low", "PURSUE", 70, 0.5),
      createTestOpportunity("consider-high", "CONSIDER", 85, 0.9),
      createTestOpportunity("pursue-high", "PURSUE", 95, 0.9),
    ];

    const sorted = sortOpportunities(ops);
    const decisions = sorted.map((o) => o.decision);

    // Tier ordering: PURSUE < CONSIDER < PASS
    expect(decisions[0]).toBe("PURSUE");
    expect(decisions[1]).toBe("PURSUE");
    expect(decisions[2]).toBe("CONSIDER");
    expect(decisions[3]).toBe("CONSIDER");
    expect(decisions[4]).toBe("PASS");
  });

  it("E5: Existing score ordering remains unchanged within tier", () => {
    const ops: Opportunity[] = [
      createTestOpportunity("low-score", "PURSUE", 71, 0.5),
      createTestOpportunity("high-score", "PURSUE", 95, 0.5),
      createTestOpportunity("mid-score", "PURSUE", 82, 0.5),
    ];

    const sorted = sortOpportunities(ops);
    const hashes = sorted.map((o) => o.jobHash);

    // Higher scores should rank first
    expect(hashes[0]).toBe("high-score"); // 95
    expect(hashes[1]).toBe("mid-score"); // 82
    expect(hashes[2]).toBe("low-score"); // 71
  });

  it("E6: No score values are modified by sorting", () => {
    const ops: Opportunity[] = [
      createTestOpportunity("opp-a", "CONSIDER", 65, 0.7),
      createTestOpportunity("opp-b", "CONSIDER", 65, 0.9),
    ];

    const sorted = sortOpportunities(ops);

    // Scores should be unchanged
    expect(sorted[0].recommendationResult?.score).toBe(65);
    expect(sorted[1].recommendationResult?.score).toBe(65);

    // Confidence should be unchanged
    expect(sorted[0].recommendationResult?.decisionConfidence?.confidence).toBe(0.9);
    expect(sorted[1].recommendationResult?.decisionConfidence?.confidence).toBe(0.7);
  });

  it("E7: No decision tiers are modified", () => {
    const ops: Opportunity[] = [
      createTestOpportunity("opp-a", "PURSUE", 70, 0.7),
      createTestOpportunity("opp-b", "CONSIDER", 65, 0.8),
      createTestOpportunity("opp-c", "PASS", 40, 0.9),
    ];

    const sorted = sortOpportunities(ops);

    // Tiers should be unchanged
    expect(sorted[0].decision).toBe("PURSUE");
    expect(sorted[1].decision).toBe("CONSIDER");
    expect(sorted[2].decision).toBe("PASS");
  });

  it("E8: Complete tie-break chain - score → confidence → jobHash", () => {
    const ops: Opportunity[] = [
      // Same score group 1 (70)
      createTestOpportunity("zulu-70", "PURSUE", 70, 0.6),
      createTestOpportunity("alpha-70", "PURSUE", 70, 0.8),
      createTestOpportunity("beta-70", "PURSUE", 70, 0.8), // Same confidence as alpha
      // Same score group 2 (65)
      createTestOpportunity("zebra-65", "CONSIDER", 65, 0.9),
      createTestOpportunity("apple-65", "CONSIDER", 65, 0.9), // Same confidence as zebra
    ];

    const sorted = sortOpportunities(ops);
    const hashes = sorted.map((o) => o.jobHash);

    // Expected order:
    // 1. PURSUE 70, confidence 0.8 (alpha-70 - alphabetical)
    // 2. PURSUE 70, confidence 0.8 (beta-70)
    // 3. PURSUE 70, confidence 0.6 (zulu-70)
    // 4. CONSIDER 65, confidence 0.9 (apple-65 - alphabetical)
    // 5. CONSIDER 65, confidence 0.9 (zebra-65)
    expect(hashes).toEqual(["alpha-70", "beta-70", "zulu-70", "apple-65", "zebra-65"]);
  });

  it("E9: Opportunities with null/undefined confidence handled gracefully", () => {
    const opWithNullConfidence: Opportunity = {
      ...createTestOpportunity("null-conf", "CONSIDER", 65, 0),
      recommendationResult: {
        score: 65,
        decision: "CONSIDER",
        policyId: "policy-v4.3",
        policyVersion: "1.0.0",
        explanation: "Test",
        capabilities: [],
        // decisionConfidence is undefined
      },
    } as Opportunity;

    const opWithConfidence = createTestOpportunity("has-conf", "CONSIDER", 65, 0.8);

    const ops: Opportunity[] = [opWithNullConfidence, opWithConfidence];
    const sorted = sortOpportunities(ops);

    // Opportunity with confidence should rank higher than one without
    expect(sorted[0].jobHash).toBe("has-conf");
    expect(sorted[1].jobHash).toBe("null-conf");
  });
});
