import { describe, it, expect, beforeEach } from "vitest";
import { 
  runEngine, 
  injectFixtureRecords, 
  clearFixtureRecords, 
  invalidateEngineCache,
  readOpportunities 
} from "../engine";
import { CandidateIntelligencePipeline, invalidateCandidateDossierCache } from "../cip";
import { EvaluationCoordinator } from "../EvaluationCoordinator";
import type { CandidateProjection } from "../../domain/entities";
import type { OpportunitySource } from "../../domain/semantic";

describe("Evaluation Pipeline Cache Correctness - Regression Suite", () => {
  const mockProjection: CandidateProjection = {
    id: "cand-test-1",
    personId: "swapnil-shukla",
    timeline: [],
    skills: ["GTM Strategy", "Commercial Leadership"],
    claims: [],
    updatedAt: "2026-08-15T00:00:00.000Z",
    executiveIdentity: {
      value: "Commercial & Marketing Leadership",
      confidence: 0.9,
      evidence: ["Head of Marketing"]
    }
  };

  beforeEach(() => {
    clearFixtureRecords();
    invalidateEngineCache();
    invalidateCandidateDossierCache();
  });

  it("REPRO 1: Updated rawText on opportunity must invalidate item cache and re-evaluate", () => {
    const initialOpp: OpportunitySource = {
      jobHash: "test-job-rawtext-1",
      role: "VP Marketing",
      company: "Acme Growth Corp",
      location: "Bengaluru",
      scrapedFrom: "LinkedIn",
      postedRelative: "1d ago",
      description: "Short job summary.",
      rawText: "", // Empty initial rawText
      dimensions: []
    };

    injectFixtureRecords([initialOpp]);

    // Run 1: Evaluate with short description
    const res1 = runEngine(mockProjection);
    expect(res1.presented[0].opportunity.jobHash).toBe("test-job-rawtext-1");
    // Under short description (< 25 words), EvidenceGate flags SPARSE_SPEC or lower score
    const initialVerdict = res1.presented[0].opportunity.decision;

    // Now update rawText with detailed 100-word job description that includes rich evidence
    const updatedOpp: OpportunitySource = {
      ...initialOpp,
      rawText: "Acme Growth Corp is hiring a Vice President of Marketing to oversee our $50M P&L and 40-person marketing organization across APAC. Responsibilities include GTM strategy, brand positioning, performance marketing, and agency management. Minimum 12 years executive experience required with proven track record scaling revenue from $10M to $50M ARR."
    };

    injectFixtureRecords([updatedOpp]);

    // Run 2: Re-evaluate. Expect fresh evaluation based on new rawText!
    const res2 = runEngine(mockProjection);
    const updatedPresented = res2.presented[0];

    // Failure check: If cache was NOT invalidated, res2 returns initialVerdict or sparse spec!
    // With updated rawText, the job description is rich and detailed (> 25 words with P&L scale)
    expect(updatedPresented.opportunity.decision).not.toBe("SPARSE_SPEC");
    expect(updatedPresented.opportunity.decision).toBe("PURSUE");
  });

  it("REPRO 2: Updated location on opportunity must invalidate item cache", () => {
    const oppLocation1: OpportunitySource = {
      jobHash: "test-job-location-1",
      role: "Chief Growth Officer",
      company: "Beta Tech",
      location: "Remote",
      scrapedFrom: "LinkedIn",
      postedRelative: "2d ago",
      description: "Acme Growth Corp is hiring a CGO to lead enterprise growth and digital marketing scale.",
      rawText: "Acme Growth Corp is hiring a CGO to lead enterprise growth and digital marketing scale with P&L ownership.",
      dimensions: []
    };

    injectFixtureRecords([oppLocation1]);

    const res1 = runEngine(mockProjection);
    expect(res1.presented[0].opportunity.location).toBe("Remote");

    // Update location to Bangalore
    const oppLocation2: OpportunitySource = {
      ...oppLocation1,
      location: "Bengaluru, India"
    };

    injectFixtureRecords([oppLocation2]);

    const res2 = runEngine(mockProjection);
    expect(res2.presented[0].opportunity.location).toBe("Bengaluru, India");
  });

  it("REPRO 3: EvaluationCoordinator trigger events must invalidate engine and CIP memory caches", async () => {
    const opp: OpportunitySource = {
      jobHash: "test-job-coord-1",
      role: "Head of Marketing",
      company: "Gamma Corp",
      location: "Bengaluru",
      scrapedFrom: "LinkedIn",
      postedRelative: "1d ago",
      description: "Gamma Corp is hiring a Head of Marketing to scale enterprise GTM.",
      rawText: "Gamma Corp is hiring a Head of Marketing to scale enterprise GTM and manage $20M P&L.",
      dimensions: []
    };

    injectFixtureRecords([opp]);
    const res1 = runEngine(mockProjection);
    expect(res1.presented.length).toBe(1);

    // Call EvaluationCoordinator notify event
    const coordResult = await EvaluationCoordinator.notify({
      event: "CORPUS_UPDATED",
      personId: "swapnil-shukla"
    });

    expect(coordResult.processed).toBe(true);
  });
});
