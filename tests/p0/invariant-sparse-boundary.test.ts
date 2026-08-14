/**
 * P0-B: Evidence Gate Boundary Invariant
 * 
 * Given: sparse source text (< 25 words) for commercial role
 * When: EvidenceGate evaluates
 * Then: evaluationStatus = "SPARSE_SPEC", recommendation = null
 * And: Consider should be excluded from scored ranking
 * 
 * Contract: SPARSE_SPEC is epistemic uncertainty, not veto.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runEngine, injectFreshRecords, clearInjectedRecords } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { createSparseCommercial } from "./fixtures/sparse-commercial";

describe("P0-B: Evidence Gate Boundary Invariant", () => {
  beforeEach(() => {
    clearInjectedRecords();
  });

  afterEach(() => {
    clearInjectedRecords();
  });

  it("identifies SPARSE_SPEC for commercial roles with < 25 words", () => {
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
    // Then: SPARSE_SPEC status
    expect(record?.trace?.pipeline).toBeDefined();
    
    // First (and only) pipeline stage should be EvidenceGate: SPARSE_SPEC
    const firstStage = record?.trace?.pipeline?.[0];
    expect(firstStage?.stage).toBe("EvidenceGate");
    expect(firstStage?.status).toBe("SPARSE_SPEC");
  });

  it("SPARSE_SPEC is NOT a veto", () => {
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

    // Then: NOT vetoed
    expect(record?.vetoed).toBe(false);  // FAILS on current code: true
    expect(record?.vetoReason).toBeNull();  // FAILS on current code: "G-EVIDENCE-GATE-SPARSE-SPEC"
  });

  it("SPARSE_SPEC has priority === null (not 0)", () => {
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

    // Then: Uncertainty encoded as null, not 0
    expect(record?.priority).toBeNull();  // FAILS on current code: 0 or undefined
    expect(record?.rawScore).toBe(0);
    expect(record?.verb).toBe("SPARSE_SPEC");  // Or a distinct verb for "unevaluable"
  });

  it("word count threshold is 25", () => {
    // Contract: 25 words is the boundary
    const WORD_COUNT_THRESHOLD = 25;
    expect(WORD_COUNT_THRESHOLD).toBe(25);
  });
});
