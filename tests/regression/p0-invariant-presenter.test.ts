/**
 * P0-F: Presenter Purity Invariant (FINAL)
 * 
 * STRICT PROJECTION CONTRACT:
 * For every semantic field X:
 *   presented.X === record.X
 * 
 * No transformation. No mapping. No interpretation.
 * 
 * Semantic fields:
 * - score / priority
 * - decision / verb
 * - confidence
 * - vetoed
 * - evaluationStatus / diligenceStatus (must be 1:1, not mapping)
 * - policyVersion / recommendationVersion
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runEngine, injectFreshRecords, clearInjectedRecords } from "@/lib/intelligence/engine";
import { present } from "@/lib/intelligence/present";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { createSparseCommercial } from "./fixtures/sparse-commercial";
import { createGroundedCommercial } from "./fixtures/grounded-commercial";

describe("P0-F: Presenter Pure Projection Invariant", () => {
  beforeEach(() => {
    clearInjectedRecords();
  });

  afterEach(() => {
    clearInjectedRecords();
  });

  it("presented.score === record.priority", () => {
    const fixture = createGroundedCommercial();
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

    const presented = present(fixture as any, record!, projection as any);
    
    // STRICT: presented.score must equal record.priority
    expect(presented.record.priority).toBe(record!.priority);
    expect(presented.opportunity.recommendationResult?.score).toBe(record!.priority);
  });

  it("presented.confidence === record.confidence", () => {
    const fixture = createGroundedCommercial();
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

    const presented = present(fixture as any, record!, projection as any);
    
    // STRICT: presented.confidence must equal record.confidence
    expect(presented.record.confidence).toBe(record!.confidence);
    expect(presented.opportunity.recommendationResult?.decisionConfidence?.overall).toBe(record!.confidence);
  });

  it("presented.decision === record.verb", () => {
    const fixture = createGroundedCommercial();
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

    const presented = present(fixture as any, record!, projection as any);
    
    // STRICT: presented.decision must equal record.verb
    expect(presented.record.verb).toBe(record!.verb);
    expect(presented.opportunity.decision).toBe(record!.verb);
    expect(presented.opportunity.recommendationResult?.decision).toBe(record!.verb);
  });

  it("presented.vetoed === record.vetoed", () => {
    const fixture = createGroundedCommercial();
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

    const presented = present(fixture as any, record!, projection as any);
    
    // STRICT: presented.vetoed must equal record.vetoed
    expect(presented.record.vetoed).toBe(record!.vetoed);
    expect(presented.opportunity.recommendationResult?.vetoed ?? false).toBe(!!record!.vetoed);
  });

  it("presented.evaluationStatus === record.evaluationStatus", () => {
    // STRICT: No mapping. No transformation. 
    // If UI field is named differently, it must contain same value.
    
    const fixture = createGroundedCommercial();
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

    const presented = present(fixture as any, record!, projection as any);
    
    // STRICT EQUALITY: No toLowerCase(), no mapping, no partial match
    // If UI uses different field name, that field must contain exact value.
    // Note: RecommendationRecord has diligenceStatus, not evaluationStatus
    expect(presented.opportunity.diligenceStatus).toBe(record!.diligenceStatus);
    
    // Current code may FAIL here if it maps:
    //   record.evaluationStatus: "EVALUATED"
    //   presented.diligenceStatus: "READY"
    // That is NOT pure projection.
    // Fix: change field name, or change value, but don't transform.
  });

  it("presenter does NOT invent semantics for null priority", () => {
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

    const presented = present(fixture as any, record!, projection as any);
    
    // STRICT: For null priority, UI fields must also be null
    expect(presented.opportunity.recommendationResult?.decisionConfidence?.overall)
      .toBe(record!.confidence);  // Precision: record value, not 0.80
  });

  it("presenter semantic contract: all visible attributes are pure projections", () => {
    const fixture = createGroundedCommercial();
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

    const presented = present(fixture as any, record!, projection as any);
    const result = presented.opportunity.recommendationResult;
    
    // STRICT: Every semantic field matches exactly
    expect(result?.score).toBe(record!.priority);
    expect(result?.decision).toBe(record!.verb);
    expect(result?.decisionConfidence?.overall).toBe(record!.confidence);
    expect(result?.policyVersion).toBe(record!.recommendationVersion);
    expect(result?.vetoed ?? false).toBe(!!record!.vetoed);
  });

  it("presenter does NOT transform values", () => {
    // ENSURE: No function in presenter maps values
    // No if (record.priority === null) return 0.80
    // No Math.max(0.3, Math.min(0.95, ...))
    // No String(record.verb).toLowerCase()
    
    // This is a meta-test: ensure present() is implementation is projection-only
    // If present.ts contains value-transforming logic, it violates P0-F
    
    // We verify by checking that two different values are preserved exactly
    const fixtures = [
      { ...createGroundedCommercial(), jobHash: "p0-transform-test-1", rawText: "CMO. P&L. 75 score." },
      { ...createGroundedCommercial(), jobHash: "p0-transform-test-2", rawText: "CMO. P&L. 60 score." }
    ];
    
    injectFreshRecords(fixtures);

    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { achievements: [], yearsExperience: 12 },
      evidence: [],
      preferences: { locations: [], workModel: "HYBRID" }
    } as any);
    
    const { records } = runEngine(projection as any, 0);
    
    for (const record of records.slice(0, 2)) {
      const fixture = fixtures.find(f => f.jobHash === record.jobHash)!;
      const presented = present(fixture as any, record, projection as any);
      
      const uiScore = presented.opportunity.recommendationResult?.score;
      const recordScore = record.priority;
      
      // EXACT equality, not approximate
      expect(uiScore).toBe(recordScore);
    }
  });
});
