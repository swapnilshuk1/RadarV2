import { describe, it, expect, beforeEach } from "vitest";
import { 
  runEngine, 
  injectFixtureRecords,
  invalidateEngineCache 
} from "../../src/lib/intelligence/engine";
import { invalidateCandidateDossierCache } from "../../src/lib/intelligence/cip";
import type { CandidateProjection } from "../../src/domain/entities";
import type { OpportunitySource } from "../../src/domain/semantic";

describe("Evaluation Pipeline Cache Correctness - Regression Suite", () => {
  const mockProjection1: CandidateProjection = {
    id: "cand-test-1",
    personId: "swapnil-shukla",
    timeline: [],
    skills: ["GTM Strategy", "Commercial Leadership"],
    claims: [],
    coreCapabilities: ["GTM Strategy", "Commercial Leadership"],
    preferredLocations: ["Bengaluru", "Remote"],
    workModelPreference: "HYBRID",
    updatedAt: "2026-08-15T00:00:00.000Z",
    executiveIdentity: {
      value: "Commercial & Marketing Leadership",
      confidence: 0.9,
      evidence: ["Head of Marketing"]
    },
    operatingLevel: {
      value: "EXECUTIVE",
      confidence: 0.9,
      evidence: ["VP Marketing"]
    },
    workNature: {
      value: "STRATEGIC",
      confidence: 0.9,
      evidence: ["GTM Scaling"]
    },
    decisionAuthority: {
      value: "AUTHORITATIVE",
      confidence: 0.9,
      evidence: ["P&L Owner"]
    },
    commercialScope: {
      value: "ENTERPRISE",
      confidence: 0.9,
      evidence: ["Global Scope"]
    }
  } as any;

  // Projection 2 has updated timestamp -> forces topLevelCacheKey miss, testing itemEvaluationCache behavior
  const mockProjection2: CandidateProjection = {
    ...mockProjection1,
    updatedAt: "2026-08-15T01:00:00.000Z"
  };

  beforeEach(() => {
    invalidateEngineCache();
    invalidateCandidateDossierCache();
  });

  it("PROVEN FAILURE 1: Text fallback priority mismatch causes item cache hit with stale text evaluation", () => {
    const oppList: OpportunitySource[] = [{
      jobHash: "test-job-rawtext-1",
      role: "VP Marketing",
      company: "Acme Growth Corp",
      location: "Bengaluru",
      scrapedFrom: "LinkedIn",
      postedRelative: "1d ago",
      description: "Short summary", // < 25 words -> SPARSE_SPEC
      rawText: "",
      dimensions: []
    }];

    injectFixtureRecords(oppList);

    // Run 1 with projection 1
    const res1 = runEngine(mockProjection1);
    expect(res1.presented[0].opportunity.decision).toBe("SPARSE_SPEC");

    // Update rawText in oppList and re-inject (which updates memoryCache but preserves itemCache if signature matches)
    const updatedOppList: OpportunitySource[] = [{
      ...oppList[0],
      rawText: "Acme Growth Corp is hiring a Vice President of Marketing to oversee our $50M P&L and 40-person marketing organization across APAC. Responsibilities include GTM strategy, brand positioning, performance marketing, and agency management. Minimum 12 years executive experience required with proven track record scaling revenue from $10M to $50M ARR."
    }];

    // Update memoryCache without calling invalidateEngineCache()
    // (simulating live database update read by getBaseOpportunities)
    injectFixtureRecords(updatedOppList);

    // Run 2 with projection 2 (topLevelCacheKey misses, itemCache checked)
    const res2 = runEngine(mockProjection2);

    console.log("Run 1 Decision:", res1.presented[0].opportunity.decision);
    console.log("Run 2 Decision:", res2.presented[0].opportunity.decision);

    // Expect decision to reflect new rawText (e.g. PURSUE/CONSIDER) instead of stale SPARSE_SPEC!
    expect(res2.presented[0].opportunity.decision).not.toBe("SPARSE_SPEC");
  });

  it("PROVEN FAILURE 2: Location property missing from oppContentHash causes stale location on item cache hit", () => {
    const oppList: OpportunitySource[] = [{
      jobHash: "test-job-location-1",
      role: "Chief Growth Officer",
      company: "Beta Tech",
      location: "Remote",
      scrapedFrom: "LinkedIn",
      postedRelative: "2d ago",
      description: "Acme Growth Corp is hiring a CGO to lead enterprise growth and digital marketing scale with $20M P&L responsibility.",
      rawText: "Acme Growth Corp is hiring a CGO to lead enterprise growth and digital marketing scale with P&L ownership.",
      dimensions: []
    }];

    injectFixtureRecords(oppList);

    const res1 = runEngine(mockProjection1);
    expect(res1.presented[0].opportunity.location).toBe("Remote");

    // Update location to Bengaluru, India in oppList
    const updatedOppList: OpportunitySource[] = [{
      ...oppList[0],
      location: "Bengaluru, India"
    }];

    injectFixtureRecords(updatedOppList);

    // Run 2 with projection 2
    const res2 = runEngine(mockProjection2);

    console.log("Run 1 Location:", res1.presented[0].opportunity.location);
    console.log("Run 2 Location:", res2.presented[0].opportunity.location);

    // Location on presented opportunity must be "Bengaluru, India"
    expect(res2.presented[0].opportunity.location).toBe("Bengaluru, India");
  });
});
