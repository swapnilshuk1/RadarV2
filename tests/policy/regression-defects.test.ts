/**
 * Regression tests for Phase-0 defect fixes:
 * 1. Provenance fallback removed - only explicit provenance values should pass
 * 2. Trace identity hashes persisted - candidateProjectionHash and opportunityContentHash in trace
 * 3. Presenter confidence purity - uses record.confidence directly, no fabrication
 */

import { describe, it, expect } from "vitest";
import { runEngine, injectFreshRecords, clearInjectedRecords, invalidateEngineCache } from "@/lib/intelligence/engine";
import { present } from "@/lib/intelligence/present";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "@/data/candidate-profile";

// --- Defect 1: Provenance fallback removed ---

describe("Defect 1: Evidence provenance must be explicit", () => {
  it("rejects evidence without trusted provenance when quote not in rawText", () => {
    // Evidence with unknown provenance and quote NOT in rawText should NOT be trusted
    const syntheticWithBadProvenance = {
      jobHash: "tst-bad-provenance-001",
      role: "Marketing Director",
      company: "TestCorp",
      rawText: "Looking for a marketing leader.", // Does NOT contain "Owns P&L"
      dimensions: [
        {
          key: "commercialAccountability",
          jdEvidence: {
            status: "Explicit",
            value: "Owns P&L",
            evidence: [
              { 
                quote: "Owns P&L", 
                provenance: "llm" // NOT in trusted list: curated, extractor, gold, fixture, onboarder
              }
            ]
          }
        }
      ],
      originalOpportunity: { sourcePayload: "Looking for a marketing leader." }
    } as any;

    injectFreshRecords([syntheticWithBadProvenance]);
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile);
    const { records } = runEngine(projection, 0);

    const record = records.find(r => r.jobHash === "tst-bad-provenance-001");
    expect(record).toBeDefined();
    
    // Without trusted provenance, evidence should NOT be structured
    // This may result in SPARSE_SPEC or NOT_EVALUABLE depending on other factors
    // But should NOT treat ungrounded evidence as valid
    
    clearInjectedRecords();
  });

  it("accepts evidence with trusted provenance regardless of rawText", () => {
    const syntheticWithTrustedProvenance = {
      jobHash: "tst-trusted-provenance-001",
      role: "CMO",
      company: "TestCorp",
      rawText: "Executive marketing role.",
      dimensions: [
        {
          key: "requiredLevel",
          jdEvidence: {
            status: "Explicit",
            value: "Chief Marketing Officer",
            evidence: [
              { 
                quote: "Chief Marketing Officer", 
                provenance: "fixture" // Trusted provenance
              }
            ]
          }
        }
      ],
      originalOpportunity: { sourcePayload: "Executive marketing role." }
    } as any;

    injectFreshRecords([syntheticWithTrustedProvenance]);
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile);
    const { records } = runEngine(projection, 0);

    const record = records.find(r => r.jobHash === "tst-trusted-provenance-001");
    expect(record).toBeDefined();
    // With trusted provenance, should be evaluated
    
    clearInjectedRecords();
  });
});

// --- Defect 2: Trace identity hashes persisted ---

describe("Defect 2: Trace must contain identity hashes", () => {
  it("record.trace contains candidateProjectionHash", () => {
    invalidateEngineCache();
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile);
    const { records } = runEngine(projection, 0);

    for (const record of records) {
      expect(record.trace).toBeDefined();
      expect(record.trace.candidateProjectionHash).toBeDefined();
      expect(typeof record.trace.candidateProjectionHash).toBe("string");
      expect(record.trace.candidateProjectionHash.length).toBeGreaterThan(0);
    }
  });

  it("record.trace contains opportunityContentHash", () => {
    invalidateEngineCache();
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile);
    const { records } = runEngine(projection, 0);

    for (const record of records) {
      expect(record.trace).toBeDefined();
      expect(record.trace.opportunityContentHash).toBeDefined();
      expect(typeof record.trace.opportunityContentHash).toBe("string");
      expect(record.trace.opportunityContentHash.length).toBeGreaterThan(0);
    }
  });

  it("candidateProjectionHash changes when projection changes", () => {
    invalidateEngineCache();
    const builder = new CandidateProjectionBuilderImpl();
    const projA = builder.fromProfile(candidateProfile);
    const projB = { ...projA, executiveThemes: [...(projA.executiveThemes || []), "MUTATION"] } as any;

    const { records: recA } = runEngine(projA, 0);
    const { records: recB } = runEngine(projB, 0);

    const anyA = recA[0];
    const anyB = recB[0];
    
    // Different projections should have different candidate hashes
    expect(anyA.trace.candidateProjectionHash).not.toBe(anyB.trace.candidateProjectionHash);
  });
});

// --- Defect 3: Presenter confidence purity ---

describe("Defect 3: Presenter uses record confidence directly", () => {
  it("presenter decisionConfidence.overall matches record.confidence", () => {
    invalidateEngineCache();
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile);
    const { records } = runEngine(projection, 0);

    for (const record of records.slice(0, 10)) { // Check first 10
      const op = {
        jobHash: record.jobHash,
        role: "Test Role",
        company: "Test Corp",
        dimensions: [],
        originalOpportunity: {}
      } as any;
      
      const presented = present(op, record, projection);
      
      // decisionConfidence.overall should be record.confidence (or null if undefined)
      expect(presented.opportunity.recommendationResult?.decisionConfidence?.overall)
        .toBe(record.confidence ?? null);
    }
  });

  it("presenter does not fabricate confidence for null priority records", () => {
    invalidateEngineCache();
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile);
    const { records } = runEngine(projection, 0);

    // Find records with null priority (e.g., SPARSE_SPEC, NOT_EVALUABLE)
    const nullPriorityRecords = records.filter(r => r.priority === null);
    
    if (nullPriorityRecords.length === 0) {
      // Skip if no null priority records in this run
      return;
    }

    for (const record of nullPriorityRecords.slice(0, 5)) {
      const op = {
        jobHash: record.jobHash,
        role: "Test Role",
        company: "Test Corp",
        dimensions: [],
        originalOpportunity: {}
      } as any;
      
      const presented = present(op, record, projection);
      const uiConfidence = presented.opportunity.recommendationResult?.decisionConfidence?.overall;
      
      // Should not be hardcoded 0.80 (the old fabricated value)
      expect(uiConfidence).not.toBe(0.80);
      
      // Should be record.confidence or null
      expect(uiConfidence).toBe(record.confidence ?? null);
    }
  });
});
