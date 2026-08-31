import { describe, it, expect } from "vitest";
import { resolveShortlistCardBadgeState } from "../../src/routes/index";
import type { Opportunity } from "../../src/data/opportunity-fixtures";

describe("Shortlist Card Badge Resolution Regression Tests", () => {
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

  it("A. Fresh PURSUE -> Shortlist shows PURSUE", () => {
    const opp: Opportunity = {
      ...baseOpportunity,
      reviewWorkflowState: "UNREVIEWED",
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 85,
        vetoed: false,
      } as any,
      userDecision: null,
    };

    const res = resolveShortlistCardBadgeState(opp);
    expect(res.primaryLabel).toBe("pursue");
    expect(res.badgeClass).toBe("badge-pursue");
    expect(res.isStale).toBe(false);
    expect(res.staleLabel).toBeNull();
    expect(res.previousAction).toBeNull();
  });

  it("B. Fresh CONSIDER -> Shortlist shows CONSIDER", () => {
    const opp: Opportunity = {
      ...baseOpportunity,
      reviewWorkflowState: "UNREVIEWED",
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 72,
        vetoed: false,
      } as any,
      userDecision: null,
    };

    const res = resolveShortlistCardBadgeState(opp);
    expect(res.primaryLabel).toBe("consider");
    expect(res.badgeClass).toBe("badge-consider");
    expect(res.isStale).toBe(false);
    expect(res.staleLabel).toBeNull();
    expect(res.previousAction).toBeNull();
  });

  it("C. REVIEWED_STALE + previous PURSUE + current engine CONSIDER -> Shortlist primary badge shows CONSIDER, not PURSUE", () => {
    const opp: Opportunity = {
      ...baseOpportunity,
      reviewWorkflowState: "REVIEWED_STALE",
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 72,
        vetoed: false,
      } as any,
      userDecision: {
        userAction: "PURSUE",
      } as any,
    };

    const res = resolveShortlistCardBadgeState(opp);
    expect(res.primaryLabel).toBe("consider");
    expect(res.badgeClass).toBe("badge-consider");
    expect(res.isStale).toBe(true);
    expect(res.staleLabel).toBe("Re-evaluated");
  });

  it("D. REVIEWED_UNKNOWN + previous PURSUE + current engine CONSIDER -> Shortlist primary badge shows CONSIDER", () => {
    const opp: Opportunity = {
      ...baseOpportunity,
      reviewWorkflowState: "REVIEWED_UNKNOWN",
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 73,
        vetoed: false,
      } as any,
      userDecision: {
        userAction: "PURSUE",
      } as any,
    };

    const res = resolveShortlistCardBadgeState(opp);
    expect(res.primaryLabel).toBe("consider");
    expect(res.badgeClass).toBe("badge-consider");
    expect(res.isStale).toBe(true);
    expect(res.staleLabel).toBe("Review again");
  });

  it("E. Historical PURSUE remains available as secondary context", () => {
    const opp: Opportunity = {
      ...baseOpportunity,
      reviewWorkflowState: "REVIEWED_STALE",
      engineRecommendation: {
        engineVerdict: "CONSIDER",
        qualityScore: 72,
        vetoed: false,
      } as any,
      userDecision: {
        userAction: "PURSUE",
      } as any,
    };

    const res = resolveShortlistCardBadgeState(opp);
    expect(res.previousAction).toBe("PURSUE");
  });

  it("F. SPARSE_SPEC remains unchanged", () => {
    const opp: Opportunity = {
      ...baseOpportunity,
      evaluationState: "SPARSE_SPEC" as any,
      decision: null as any,
      reviewWorkflowState: "UNREVIEWED",
      engineRecommendation: {
        engineVerdict: null as any,
        qualityScore: null,
        vetoed: false,
      } as any,
      userDecision: null,
    };

    const res = resolveShortlistCardBadgeState(opp);
    expect(res.primaryLabel).toBe("needs more signal");
    expect(res.badgeClass).toContain("text-amber-600");
    expect(res.isStale).toBe(false);
  });

  it("G. PASS remains PASS", () => {
    const opp: Opportunity = {
      ...baseOpportunity,
      reviewWorkflowState: "UNREVIEWED",
      engineRecommendation: {
        engineVerdict: "PASS",
        qualityScore: 45,
        vetoed: false,
      } as any,
      userDecision: null,
    };

    const res = resolveShortlistCardBadgeState(opp);
    expect(res.primaryLabel).toBe("pass");
    expect(res.badgeClass).toBe("badge-pass");
    expect(res.isStale).toBe(false);
  });
});
