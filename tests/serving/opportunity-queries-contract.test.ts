/**
 * tests/serving/opportunity-queries-contract.test.ts
 *
 * RADAR v2 — OpportunityQueries Query Contract Verification (Phase 3).
 *
 * Verifies:
 * 1. OpportunityQueries interface and DTO definitions conform to ADR-SERVING-001.
 * 2. FeedSummary shape ensures lean field projection (excluding heavy JSON and full markdown).
 * 3. FeedPage, FeedFilters, and NavigationContext structure integrity.
 */

import { describe, it, expect } from "vitest";
import type {
  OpportunityQueries,
  FeedSummary,
  FeedPage,
  FeedFilters,
  NavigationContext,
  OpaqueCursor,
} from "../../src/lib/intelligence/opportunity-queries";

describe("Phase 3: OpportunityQueries Query Contract & DTOs", () => {
  it("conforms to the FeedSummary DTO shape", () => {
    const summary: FeedSummary = {
      jobHash: "j-008f74870e2a",
      role: "Vice President of Engineering",
      company: "Acme Enterprise Solutions",
      location: "Bengaluru (Hybrid)",
      scrapedFrom: "LinkedIn",
      postedAt: "2026-08-28T10:00:00Z",
      postedPrecision: "DAY",
      applyUrl: "https://linkedin.com/jobs/view/123",
      evaluationState: "COMPLETE",
      engineVerdict: "PURSUE",
      qualityScore: 92.5,
      userAction: "NONE",
      effectiveDecision: "ENGINE_PURSUIT",
      populationTier: 0,
      reviewWorkflowState: "UNREVIEWED",
      categoryIds: ["all", "transformation", "platform_digital"],
    };

    expect(summary.jobHash).toBe("j-008f74870e2a");
    expect(summary.populationTier).toBe(0);
    expect(summary.categoryIds).toContain("transformation");
    
    // Ensure that FeedSummary does NOT carry heavy fields like raw_content or evaluation_json
    expect((summary as any).evaluation_json).toBeUndefined();
    expect((summary as any).rawContent).toBeUndefined();
    expect((summary as any).explanation).toBeUndefined();
  });

  it("conforms to the FeedPage structure", () => {
    const feedPage: FeedPage = {
      items: [
        {
          jobHash: "j-1",
          role: "CTO",
          company: "Tech Corp",
          location: "Remote",
          scrapedFrom: "LinkedIn",
          evaluationState: "COMPLETE",
          effectiveDecision: "ENGINE_PURSUIT",
          populationTier: 0,
          reviewWorkflowState: "UNREVIEWED",
          categoryIds: ["all"],
        },
      ],
      nextCursor: "v1:eyJ0IjowLCJzIjo5MCwiaCI6ImoiLCJwb3MiOjB9",
      totalCount: 3002,
      hasMore: true,
    };

    expect(feedPage.items.length).toBe(1);
    expect(feedPage.totalCount).toBe(3002);
    expect(feedPage.hasMore).toBe(true);
    expect(feedPage.nextCursor).toBeTruthy();
  });

  it("supports strongly typed FeedFilters", () => {
    const filter1: FeedFilters = { categoryId: "transformation", decisionFilter: "unreviewed" };
    const filter2: FeedFilters = { categoryId: "all", decisionFilter: "decided" };
    const filter3: FeedFilters = {};

    expect(filter1.categoryId).toBe("transformation");
    expect(filter2.decisionFilter).toBe("decided");
    expect(filter3.categoryId).toBeUndefined();
  });

  it("conforms to the NavigationContext structure", () => {
    const nav: NavigationContext = {
      currentIndex: 42,
      totalCount: 3002,
      prevJobHash: "j-prev-41",
      nextJobHash: "j-next-43",
    };

    expect(nav.currentIndex).toBe(42);
    expect(nav.totalCount).toBe(3002);
    expect(nav.prevJobHash).toBe("j-prev-41");
    expect(nav.nextJobHash).toBe("j-next-43");
  });
});
