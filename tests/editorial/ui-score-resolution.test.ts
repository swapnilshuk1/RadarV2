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

  it("3. canonical engine score overrides conflicting presentation and legacy scores", () => {
    const v4Opp: Opportunity = {
      ...baseOpportunity,
      engineRecommendation: {
        qualityScore: 75,
        engineVerdict: "PURSUE",
      } as any,
      recommendationResult: {
        score: 60,
      } as any,
      brief: {
        qualityScore: 92,
      },
    } as any;

    const shortlistRes = resolveShortlistCardScore(v4Opp as any);
    expect(shortlistRes.rawScore).toBe(75);
    expect(shortlistRes.scoreDisplay).toBe(75);

    const decisionsRes = resolveDecisionsCardScore(v4Opp);
    expect(decisionsRes).toBe("Fit Index 75%");

  });

  it("4. legacy recommendationResult score is not treated as canonical score", () => {
    const legacyOpp: Opportunity = {
      ...baseOpportunity,
      recommendationResult: {
        score: 81,
      } as any,
    };

    const shortlistRes = resolveShortlistCardScore(legacyOpp);
    expect(shortlistRes.rawScore).toBeUndefined();
    expect(shortlistRes.scoreDisplay).toBe("—");

    const decisionsRes = resolveDecisionsCardScore(legacyOpp);
    expect(decisionsRes).toBe("Unscored");
  });

  it("5. presentation and legacy scores cannot influence either resolver", () => {
    const opportunity: Opportunity = {
      ...baseOpportunity,
      engineRecommendation: {
        qualityScore: 70,
        engineVerdict: "CONSIDER",
      } as any,
      recommendationResult: { score: 100 } as any,
      brief: { qualityScore: 99 },
    } as any;

    expect(resolveShortlistCardScore(opportunity as any)).toEqual({ rawScore: 70, scoreDisplay: 70 });
    expect(resolveDecisionsCardScore(opportunity)).toBe("Fit Index 70%");
  });

  it("6. Genuinely missing scores render '—' on Shortlist and fallback verdict on Decisions", () => {
    const missingScoreOpp: Opportunity = {
      ...baseOpportunity,
    };

    const shortlistRes = resolveShortlistCardScore(missingScoreOpp);
    expect(shortlistRes.rawScore).toBeUndefined();
    expect(shortlistRes.scoreDisplay).toBe("—");

    const decisionsRes = resolveDecisionsCardScore(missingScoreOpp);
    expect(decisionsRes).toBe("Unscored");
  });

  it("7. Vetoed / Sparse cases preserve existing display behaviors", () => {
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
