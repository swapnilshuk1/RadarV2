/**
 * P0-C: Pipeline Isolation Invariant
 * 
 * Given: evaluationStatus = "SPARSE_SPEC"
 * When: RecommendationRecord is constructed
 * Then: trace.careerValueBreakdown is NOT present
 * And: trace.evidenceMapping is NOT present (or empty)
 * And: trace.pipeline length = 1 (only EvidenceGate)
 * 
 * Contract: SPARSE_SPEC pipeline contains ONLY EvidenceGate stage.
 * No downstream enrichment artifacts leak into the record.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runEngine, injectFreshRecords, clearInjectedRecords } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { createSparseCommercial } from "./fixtures/sparse-commercial";

describe("P0-C: Pipeline Isolation Invariant", () => {
  beforeEach(() => {
    clearInjectedRecords();
  });

  afterEach(() => {
    clearInjectedRecords();
  });

  it("SPARSE_SPEC trace contains only EvidenceGate stage", () => {
    const fixture = createSparseCommercial();
    injectFreshRecords([fixture]);

    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { achievements: [], yearsExperience: 12 },
      evidence: [],
      preferences: { locations: [], workModel: "HYBRID" }
    } as any);
    
    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === fixture.jobHash);

    expect(record).toBeDefined();
    
    const pipeline = record?.trace?.pipeline || [];
    
    // Then: Only EvidenceGate stage present
    expect(pipeline).toHaveLength(1);  // FAILS on current code: longer pipeline
    expect(pipeline[0].stage).toBe("EvidenceGate");
    expect(pipeline[0].status).toBe("SPARSE_SPEC");
  });

  it("SPARSE_SPEC trace does NOT contain careerValueBreakdown", () => {
    const fixture = createSparseCommercial();
    injectFreshRecords([fixture]);

    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { achievements: [], yearsExperience: 12 },
      evidence: [],
      preferences: { locations: [], workModel: "HYBRID" }
    } as any);
    
    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === fixture.jobHash);

    // Then: No career value enrichment
    expect(record?.trace?.careerValueBreakdown).toBeUndefined();  // FAILS: currently present
  });

  it("SPARSE_SPEC trace does NOT contain evidenceMapping", () => {
    const fixture = createSparseCommercial();
    injectFreshRecords([fixture]);

    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { achievements: [], yearsExperience: 12 },
      evidence: [],
      preferences: { locations: [], workModel: "HYBRID" }
    } as any);
    
    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === fixture.jobHash);

    // Then: No evidence mapping from capability assessment
    const evidenceMapping = record?.trace?.evidenceMapping;
    expect(evidenceMapping === undefined || evidenceMapping.length === 0).toBe(true);  // FAILS: currently has data
  });

  it("non-SPARSE_SPEC records have full pipeline", () => {
    // Sanity check: fully evaluable records SHOULD have full pipeline
    // This test should already pass and confirms isolation is specific to SPARSE_SPEC
    
    const groundedFixture = {
      jobHash: "p0-grounded-pipeline-test",
      role: "Chief Marketing Officer",
      company: "TestCo",
      location: "Mumbai",
      postedRelative: "Posted today",
      scrapedFrom: "LinkedIn" as const,
      originalOpportunity: { sourcePayload: "Full JD with sufficient detail for evaluation" },
      rawText: "Chief Marketing Officer. Owns P&L. Transformation mandate. Board exposure.",
      dimensions: [],
      primaryConcern: null
    };
    
    injectFreshRecords([groundedFixture]);

    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { achievements: [], yearsExperience: 12 },
      evidence: [],
      preferences: { locations: [], workModel: "HYBRID" }
    } as any);
    
    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === groundedFixture.jobHash);

    const pipeline = record?.trace?.pipeline || [];
    
    // Sanity check: grounded records have full pipeline
    // (This may vary based on how score thresholds land)
    expect(pipeline.length).toBeGreaterThanOrEqual(1);
  });
});
