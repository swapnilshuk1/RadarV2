import { describe, it, expect, beforeEach } from "vitest";
import { runEngine, invalidateEngineCache } from "../src/lib/intelligence/engine";
import { CandidateProjection } from "../src/domain/entities";

describe("Stage 3G Phase C — Cache Safety & Isolation Audit", () => {
  beforeEach(() => {
    invalidateEngineCache();
  });

  const sampleCandidateA: CandidateProjection = {
    personId: "cand-a",
    updatedAt: "2026-08-16T12:00:00Z",
    targetTitles: ["VP Marketing", "Chief Marketing Officer"],
    executiveThemes: ["Brand Strategy", "Demand Gen"],
    coreCapabilities: ["Marketing Leadership", "Brand Building"],
    provenLevels: ["VP", "Director"],
    evidencePool: [
      { id: "e1", text: "Led 50 person marketing team driving $100M ARR growth", domain: "Marketing" }
    ],
    compensationMin: 300000,
    preferredLocations: ["Bengaluru", "Remote"]
  };

  const sampleCandidateB: CandidateProjection = {
    personId: "cand-b",
    updatedAt: "2026-08-16T12:00:00Z",
    targetTitles: ["VP Engineering", "CTO"],
    executiveThemes: ["Distributed Systems", "Cloud Infrastructure"],
    coreCapabilities: ["Engineering Management", "System Architecture"],
    provenLevels: ["VP", "Director"],
    evidencePool: [
      { id: "e2", text: "Built global distributed infrastructure scaling to 10M DAU", domain: "Engineering" }
    ],
    compensationMin: 350000,
    preferredLocations: ["San Francisco", "Remote"]
  };

  const sampleOpportunity: any = {
    jobHash: "opp-101",
    role: "VP Engineering",
    company: "TechScale Corp",
    location: "San Francisco, CA",
    scrapedFrom: "LinkedIn",
    postedRelative: "1 day ago",
    description: "Looking for VP Engineering to lead cloud platform engineering team of 40 engineers.",
    dimensions: [
      { key: "function", label: "Engineering", jdEvidence: { status: "Verified" } }
    ]
  };

  it("Test 1 — Same user, same opportunity reuses cache safely", () => {
    const run1 = runEngine(sampleCandidateA, 0, [sampleOpportunity]);
    const run2 = runEngine(sampleCandidateA, 0, [sampleOpportunity]);

    expect(run1).toBe(run2); // Top-level cache identity equality
    expect(run1.records[0].jobHash).toBe("opp-101");
  });

  it("Test 2 — Same opportunity, different candidate MUST NOT share or leak cache", () => {
    const runA = runEngine(sampleCandidateA, 0, [sampleOpportunity]);
    const runB = runEngine(sampleCandidateB, 0, [sampleOpportunity]);

    expect(runA).not.toBe(runB);
    
    const recA = runA.records[0];
    const recB = runB.records[0];

    expect(recA.jobHash).toBe("opp-101");
    expect(recB.jobHash).toBe("opp-101");
    // Verify records are evaluated independently for different candidates
    expect(recA).not.toEqual(recB);
    expect(typeof recA.rawScore).toBe("number");
    expect(typeof recB.rawScore).toBe("number");
  });

  it("Test 3 — Candidate projection mutation invalidates old cache", () => {
    const runInitial = runEngine(sampleCandidateA, 0, [sampleOpportunity]);

    const mutatedCandidateA: CandidateProjection = {
      ...sampleCandidateA,
      updatedAt: "2026-08-16T15:00:00Z",
      targetTitles: ["VP Engineering", "CTO"],
      executiveThemes: ["Distributed Systems", "Engineering Leadership"],
      coreCapabilities: ["Engineering Management"]
    };

    const runMutated = runEngine(mutatedCandidateA, 0, [sampleOpportunity]);

    expect(runMutated).not.toBe(runInitial);
    expect(runMutated.records[0]).not.toEqual(runInitial.records[0]);
  });

  it("Test 4 — Opportunity mutation invalidates old cache", () => {
    const runInitial = runEngine(sampleCandidateA, 0, [sampleOpportunity]);

    const mutatedOpportunity = {
      ...sampleOpportunity,
      role: "VP Marketing & Growth",
      description: "Looking for VP Marketing to scale demand gen and brand strategy."
    };

    const runMutated = runEngine(sampleCandidateA, 0, [mutatedOpportunity]);

    expect(runMutated).not.toBe(runInitial);
    expect(runMutated.records[0]).not.toEqual(runInitial.records[0]);
  });

  it("Test 5 — Decision state parameter changes re-evaluate without serving stale state", () => {
    const runPursuit0 = runEngine(sampleCandidateA, 0, [sampleOpportunity]);
    const runPursuit3 = runEngine(sampleCandidateA, 3, [sampleOpportunity]);

    expect(runPursuit0).not.toBe(runPursuit3);
  });
});
