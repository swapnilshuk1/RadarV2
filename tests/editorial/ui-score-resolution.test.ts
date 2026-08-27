import { describe, it, expect } from "vitest";
import { resolveShortlistCardScore } from "../../src/routes/index";
import { resolveDecisionsCardScore } from "../../src/routes/decisions";
import type { Opportunity } from "../../src/data/opportunity-fixtures";

describe("UI Score Resolution — Shortlist & Decisions Pages", () => {
  const baseOpportunity: Opportunity = {
    jobHash: "test-hash-123",
    role: "VP of Engineering",
    company: "Acme Corp",
    location: "Bengaluru, India",
    scrapedFrom: "LinkedIn",
    scrapedAt: new Date().toISOString(),
    rawText: "VP of Engineering job description",
    whyNow: "Executive growth mandate",
  } as Opportunity;

  it("1. V4 opportunity with engineRecommendation.qualityScore renders numeric score on Shortlist", () => {
    const v4Opp: Opportunity = {
      ...baseOpportunity,
      engineRecommendation: {
        qualityScore: 88,
        engineVerdict: "PURSUE",
        vetoed: false,
        vetoReason: null,
      } as any,
    };

    const res = resolveShortlistCardScore(v4Opp);
    expect(res.rawScore).toBe(88);
    expect(res.scoreDisplay).toBe(88);
  });

  it("2. V4 opportunity with engineRecommendation.qualityScore renders Fit Index on Decisions", () => {
    const v4Opp: Opportunity = {
      ...baseOpportunity,
      engineRecommendation: {
        qualityScore: 88,
        engineVerdict: "PURSUE",
        vetoed: false,
        vetoReason: null,
      } as any,
    };

    const res = resolveDecisionsCardScore(v4Opp);
    expect(res).toBe("Fit Index 88%");
  });

  it("3. brief.qualityScore takes precedence where appropriate", () => {
    const v4Opp: Opportunity = {
      ...baseOpportunity,
      engineRecommendation: {
        qualityScore: 75,
        engineVerdict: "PURSUE",
      } as any,
      recommendationResult: {
        score: 60,
      } as any,
    };

    const brief = { qualityScore: 92 };

    const shortlistRes = resolveShortlistCardScore(v4Opp, brief);
    expect(shortlistRes.rawScore).toBe(92);
    expect(shortlistRes.scoreDisplay).toBe(92);

    const decisionsRes = resolveDecisionsCardScore(v4Opp, brief);
    expect(decisionsRes).toBe("Fit Index 92%");
  });

  it("4. Legacy recommendationResult.score works for legacy records", () => {
    const legacyOpp: Opportunity = {
      ...baseOpportunity,
      recommendationResult: {
        score: 81,
      } as any,
    };

    const shortlistRes = resolveShortlistCardScore(legacyOpp);
    expect(shortlistRes.rawScore).toBe(81);
    expect(shortlistRes.scoreDisplay).toBe(81);

    const decisionsRes = resolveDecisionsCardScore(legacyOpp);
    expect(decisionsRes).toBe("Fit Index 81%");
  });

  it("5. Genuinely missing scores render '—' on Shortlist and fallback verdict on Decisions", () => {
    const missingScoreOpp: Opportunity = {
      ...baseOpportunity,
    };

    const shortlistRes = resolveShortlistCardScore(missingScoreOpp);
    expect(shortlistRes.rawScore).toBeUndefined();
    expect(shortlistRes.scoreDisplay).toBe("—");

    const decisionsRes = resolveDecisionsCardScore(missingScoreOpp);
    expect(decisionsRes).toBe("Unscored");
  });

  it("6. Vetoed / Sparse cases preserve existing display behaviors", () => {
    const sparseOpp: Opportunity = {
      ...baseOpportunity,
      evaluationState: "SPARSE_SPEC" as any,
      decision: null as any,
      engineRecommendation: {
        qualityScore: null,
      } as any,
    };

    const shortlistRes = resolveShortlistCardScore(sparseOpp);
    expect(shortlistRes.scoreDisplay).toBe("—");

    const vetoedOpp: Opportunity = {
      ...baseOpportunity,
      engineRecommendation: {
        qualityScore: null,
        vetoed: true,
        vetoReason: "Scale Mismatch",
      } as any,
    };

    const decisionsRes = resolveDecisionsCardScore(vetoedOpp);
    expect(decisionsRes).toBe("Vetoed (Scale Mismatch)");
  });
});
