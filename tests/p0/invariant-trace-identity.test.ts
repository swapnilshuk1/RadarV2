 /**
 * P0-H: Trace Identity Invariant (FINAL)
 * 
 * CAUSALITY CONTRACT:
 * Different candidates → different candidateProjectionHash
 * Different opportunities → different opportunityContentHash
 * Same pair → same hashes (determinism)
 * Hash changes when candidate changes (cache invalidation)
 * 
 * INVARIANT: Hashes are non-empty, content-sensitive, deterministic.
 * Implementation (SHA-256, simpleStringHash) is NOT part of contract.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { runEngine, invalidateEngineCache, injectFreshRecords, clearInjectedRecords } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "@/data/candidate-profile";

  const OPPORTUNITY_A = {
    jobHash: "p0-opp-hash-test-a",
    role: "Chief Marketing Officer",
    company: "BMW India",
  location: "Gurugram",
    postedRelative: "Posted today",
    scrapedFrom: "LinkedIn" as const,
  originalOpportunity: { sourcePayload: "CMO. Owns P&L. Reports to MD." },
  rawText: "Chief Marketing Officer. Owns P&L. Reports to MD.",
    dimensions: [{ key: "requiredLevel", jdEvidence: { status: "Explicit", value: "CMO", evidence: [{ quote: "Chief Marketing Officer", provenance: "curated" }] } }],
    primaryConcern: null
  };

  const OPPORTUNITY_B = {
    jobHash: "p0-opp-hash-test-b",
    role: "VP Performance Marketing",
    company: "VML India",
  location: "Gurugram",
    postedRelative: "Posted today",
    scrapedFrom: "LinkedIn" as const,
  originalOpportunity: { sourcePayload: "VP Performance. Fee-book." },
  rawText: "VP Performance Marketing. Fee-book.",
  dimensions: [{ key: "requiredLevel", jdEvidence: { status: "Explicit", value: "VP", evidence: [{ quote: "VP Performance Marketing", provenance: "curated" }] } }],
    primaryConcern: null
  };

describe("P0-H: Trace Identity Invariant", () => {
  beforeEach(() => {
    invalidateEngineCache();
    clearInjectedRecords();
  });

  it("records contain candidateProjectionHash", () => {
    injectFreshRecords([OPPORTUNITY_A]);
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile as any);
    const { records } = runEngine(projection as any, 0);
    expect(records[0]?.trace?.candidateProjectionHash).toBeDefined();
    expect(typeof records[0]?.trace?.candidateProjectionHash).toBe("string");
  });

  it("records contain opportunityContentHash", () => {
    injectFreshRecords([OPPORTUNITY_A]);
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile as any);
    const { records } = runEngine(projection as any, 0);
    expect(records[0]?.trace?.opportunityContentHash).toBeDefined();
    expect(typeof records[0]?.trace?.opportunityContentHash).toBe("string");
  });

  it("different candidates produce different candidateProjectionHash", () => {
    injectFreshRecords([OPPORTUNITY_A]);
    const builder = new CandidateProjectionBuilderImpl();
    const projectionA = builder.fromProfile(candidateProfile as any);
    const projectionB = builder.fromProfile({ ...candidateProfile, executiveIdentity: { ...candidateProfile.executiveIdentity, executiveThemes: ["Logistics"] } } as any);
    const { records: recA } = runEngine(projectionA as any, 0);
    const { records: recB } = runEngine(projectionB as any, 0);
    expect(recA[0]?.trace?.candidateProjectionHash).not.toBe(recB[0]?.trace?.candidateProjectionHash);
  });

  it("different opportunities produce different opportunityContentHash", () => {
    injectFreshRecords([OPPORTUNITY_A, OPPORTUNITY_B]);
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile as any);
    const { records } = runEngine(projection as any, 0);
    const recA = records.find(r => r.jobHash === OPPORTUNITY_A.jobHash);
    const recB = records.find(r => r.jobHash === OPPORTUNITY_B.jobHash);
    expect(recA?.trace?.opportunityContentHash).not.toBe(recB?.trace?.opportunityContentHash);
  });
    
  it("same pair reproduce same hashes (determinism)", () => {
    injectFreshRecords([OPPORTUNITY_A]);
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile as any);
    const run1 = runEngine(projection as any, 0);
    invalidateEngineCache();
    const run2 = runEngine(projection as any, 0);
    expect(run1.records[0]?.trace?.candidateProjectionHash).toBe(run2.records[0]?.trace?.candidateProjectionHash);
    expect(run1.records[0]?.trace?.opportunityContentHash).toBe(run2.records[0]?.trace?.opportunityContentHash);
  });
  it("hash changes when candidate changes (cache invalidation)", () => {
    injectFreshRecords([OPPORTUNITY_A]);
    const builder = new CandidateProjectionBuilderImpl();
    const projA = builder.fromProfile({ ...candidateProfile, experience: { ...candidateProfile.experience, yearsExperience: 12 } } as any);
    const projB = builder.fromProfile({ ...candidateProfile, experience: { ...candidateProfile.experience, yearsExperience: 8 } } as any);
    const { records: recA } = runEngine(projA as any, 0);
    const { records: recB } = runEngine(projB as any, 0);
    expect(recA[0]?.trace?.candidateProjectionHash).not.toBe(recB[0]?.trace?.candidateProjectionHash);
  });

  it("hashes are non-empty and content-sensitive", () => {
    injectFreshRecords([OPPORTUNITY_A]);
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile(candidateProfile as any);
    const { records } = runEngine(projection as any, 0);
    expect(records[0]?.trace?.candidateProjectionHash?.length).toBeGreaterThan(0);
    expect(records[0]?.trace?.opportunityContentHash?.length).toBeGreaterThan(0);
  });
});

