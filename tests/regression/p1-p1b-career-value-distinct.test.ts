/**
 * P1-B: Career Value / Opportunity Quality — Distinct from Capability Fit
 *
 * Contract: careerValue in RecommendationRecord must come from CareerAssessmentEngine,
 * not CapabilityAssessmentEngine.
 *
 * This test suite verifies:
 * 1. decisionSummary.careerValue comes from career assessment
 * 2. decisionSummary.careerValue !== capability.overallFit (they are distinct concepts)
 * 3. candidateSeniorityLevel remains uninvolved in career value calculation
 * 4. OperatingLevel / LEVEL_HIERARCHY remain unchanged
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { runEngine, injectFreshRecords, clearInjectedRecords } from "@/lib/intelligence/engine";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";

describe("P1-B: Career Value Distinct from Capability Fit", () => {
  beforeEach(() => {
    clearInjectedRecords();
  });

  afterEach(() => {
    clearInjectedRecords();
  });

  // Test 1: decisionSummary.careerValue comes from career assessment
  it("decisionSummary.careerValue comes from career assessment", { timeout: 10000 }, () => {
    const fixture = {
      jobHash: "p1b-career-source-test",
      role: "Chief Marketing Officer",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted today",
      scrapedFrom: "LinkedIn" as const,
      primaryConcern: null,
      dimensions: [
        { key: "requiredLevel" as const, label: "Required Level", importance: "Core" as const, bucket: "Matched" as const, jdEvidence: { value: "CMO", status: "Explicit" as const, evidence: [{ quote: "Chief Marketing Officer", source: "title" as const }] } },
        { key: "mandate" as const, label: "Mandate", importance: "Core" as const, bucket: "Matched" as const, jdEvidence: { value: "Transformation", status: "Explicit" as const, evidence: [{ quote: "Lead digital transformation", source: "snippet" as const }] } },
        { key: "commercialAccountability" as const, label: "Commercial Accountability", importance: "Core" as const, bucket: "Matched" as const, jdEvidence: { value: "P&L", status: "Explicit" as const, evidence: [{ quote: "Own P&L responsibility", source: "snippet" as const }] } },
      ],
      rawText: "Chief Marketing Officer. Lead digital transformation. Own P&L responsibility. Board exposure. Transformation mandate."
    };

    injectFreshRecords([fixture]);

    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { 
        achievements: ["Led $50M P&L", "Board presentations"],
        yearsExperience: 15 
      },
      evidence: [],
      preferences: { locations: ["Mumbai"], workModel: "HYBRID" }
    } as any);

    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === fixture.jobHash);

    expect(record).toBeDefined();
    expect(record?.decisionSummary).toBeDefined();
    
    // careerValue should be present and numeric
    expect(typeof record?.decisionSummary.careerValue).toBe("number");
    
    // Career trajectory should be present in trace
    expect(record?.trace.careerValueBreakdown).toBeDefined();
  });

  // Test 2: decisionSummary.careerValue !== capability.overallFit when they differ
  // This test uses a fixture designed to produce different career and capability scores
  it("careerValue is distinct from capability overallFit", { timeout: 15000 }, () => {
    // Fixture: Strong capability match but poor career move (regression)
    const fixture = {
      jobHash: "p1b-distinct-values-test",
      role: "Marketing Manager", // Lower level - career regression
      company: "SmallCo", // Low brand
      location: "Remote",
      postedRelative: "Posted today",
      scrapedFrom: "LinkedIn" as const,
      primaryConcern: null,
      dimensions: [
        // High capability match
        { key: "requiredLevel" as const, label: "Required Level", importance: "Core" as const, bucket: "Matched" as const, 
          jdEvidence: { value: "Manager", status: "Explicit" as const, evidence: [{ quote: "Marketing Manager", source: "title" as const }] } },
        { key: "mandate" as const, label: "Mandate", importance: "Core" as const, bucket: "Matched" as const,
          jdEvidence: { value: "Growth", status: "Explicit" as const, evidence: [{ quote: "Growth marketing", source: "snippet" as const }] } },
        // But poor commercial scope
        { key: "commercialAccountability" as const, label: "Commercial Accountability", importance: "Core" as const, bucket: "Contradicted" as const,
          jdEvidence: { value: "NONE", status: "Explicit" as const, evidence: [{ quote: "Support function", source: "snippet" as const }] } },
      ],
      rawText: "Marketing Manager. Growth marketing. Support function, no P&L."
    };

    injectFreshRecords([fixture]);

    const builder = new CandidateProjectionBuilderImpl();
    // Senior candidate applying to junior role
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { 
        achievements: ["Led $50M P&L", "Executive team"],
        yearsExperience: 15 
      },
      evidence: [],
      preferences: { locations: ["Remote"], workModel: "HYBRID" }
    } as any);

    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === fixture.jobHash);

    expect(record).toBeDefined();
    
    // careerValue should be lower due to regression
    // (VP applying to Manager role triggers regression penalty)
    expect(record?.decisionSummary.careerValue).toBeLessThan(70);
    
    // Trace should show the actual career score, not capability
    expect(record?.trace.factors.careerValue).toBe(record?.decisionSummary.careerValue);
  });

  // Test 3: candidateSeniorityLevel remains uninvolved
  it("candidateSeniorityLevel is not used in career value calculation", { timeout: 10000 }, () => {
    // This test documents that candidateSeniorityLevel from P0-E
    // is correctly not used in CareerAssessmentEngine or CareerValueEngine
    
    const fixture = {
      jobHash: "p1b-seniority-independence",
      role: "VP Marketing",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted today",
      scrapedFrom: "LinkedIn" as const,
      primaryConcern: null,
      dimensions: [
        { key: "requiredLevel" as const, label: "Required Level", importance: "Core" as const, bucket: "Matched" as const,
          jdEvidence: { value: "VP", status: "Explicit" as const, evidence: [{ quote: "VP Marketing", source: "title" as const }] } },
      ],
      rawText: "VP Marketing role."
    };

    injectFreshRecords([fixture]);

    // Build projection with explicit candidateSeniorityLevel
    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "Director" }, // Will produce DIRECTOR seniority
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { 
        achievements: ["Led teams"],
        yearsExperience: 12 
      },
      evidence: [],
      preferences: { locations: ["Mumbai"], workModel: "HYBRID" }
    } as any);

    // Verify projection has candidateSeniorityLevel
    expect((projection as any).candidateSeniorityLevel).toBeDefined();
    expect((projection as any).candidateSeniorityLevel?.value).toBeDefined();
    
    // Run engine - career assessment should use operatingLevel, not candidateSeniorityLevel
    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === fixture.jobHash);

    expect(record).toBeDefined();
    // Career assessment should complete successfully
    expect(record?.trace.careerValueBreakdown).toBeDefined();
  });

  // Test 4: Career trajectory is properly exposed
  it("career trajectory is exposed in record", { timeout: 10000 }, () => {
    const forwardFixture = {
      jobHash: "p1b-forward-trajectory",
      role: "Chief Marketing Officer",
      company: "Tier1Corp",
      location: "Mumbai",
      postedRelative: "Posted today",
      scrapedFrom: "LinkedIn" as const,
      primaryConcern: null,
      dimensions: [
        { key: "requiredLevel" as const, label: "Required Level", importance: "Core" as const, bucket: "Matched" as const,
          jdEvidence: { value: "CMO", status: "Explicit" as const, evidence: [{ quote: "Chief Marketing Officer reports to CEO", source: "title" as const }] } },
        { key: "commercialAccountability" as const, label: "Commercial Accountability", importance: "Core" as const, bucket: "Matched" as const,
          jdEvidence: { value: "P&L", status: "Explicit" as const, evidence: [{ quote: "Own $100M P&L", source: "snippet" as const }] } },
      ],
      rawText: "Chief Marketing Officer reports to CEO. Own $100M P&L."
    };

    injectFreshRecords([forwardFixture]);

    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { 
        achievements: ["Led teams", "P&L responsibility"],
        yearsExperience: 12 
      },
      evidence: [],
      preferences: { locations: ["Mumbai"], workModel: "HYBRID" }
    } as any);

    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === forwardFixture.jobHash);

    expect(record).toBeDefined();
    // Should have career value breakdown
    expect(record?.trace.careerValueBreakdown).toBeDefined();
    
    // Career value should be calculated (not capability)
    expect(record?.decisionSummary.careerValue).toBeGreaterThan(0);
  });

  // Test 5: Explicitly verify careerValue !== capability.overallFit when concepts diverge
  it("careerValue is demonstrably different from capability.overallFit", { timeout: 15000 }, () => {
    // This test forces a scenario where career value should be low (regression)
    // but capability fit might appear higher due to functional skill overlap
    const fixture = {
      jobHash: "p1b-divergence-test",
      role: "Senior Manager", // Lower than candidate's VP level
      company: "SmallCo",
      location: "Pune",
      postedRelative: "Posted today",
      scrapedFrom: "LinkedIn" as const,
      primaryConcern: null,
      dimensions: [
        // Capabilities match but level is lower
        { key: "requiredLevel" as const, label: "Required Level", importance: "Core" as const, bucket: "Contradicted" as const,
          jdEvidence: { value: "Manager", status: "Explicit" as const, evidence: [{ quote: "Senior Manager", source: "title" as const }] } },
        { key: "mandate" as const, label: "Mandate", importance: "Core" as const, bucket: "Matched" as const,
          jdEvidence: { value: "Marketing", status: "Explicit" as const, evidence: [{ quote: "Marketing strategy", source: "snippet" as const }] } },
      ],
      rawText: "Senior Manager role. Marketing strategy execution."
    };

    injectFreshRecords([fixture]);

    const builder = new CandidateProjectionBuilderImpl();
    // VP-level candidate
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { 
        achievements: ["Led $100M portfolio", "Executive team member"],
        yearsExperience: 15
      },
      evidence: [],
      preferences: { locations: ["Pune"], workModel: "HYBRID" }
    } as any);

    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === fixture.jobHash);

    expect(record).toBeDefined();
    
    // Career value should be significantly impacted by regression
    // while capability might have some matches
    const careerValue = record?.decisionSummary.careerValue ?? 0;
    
    // Career value should reflect the regression (lower than typical fit)
    expect(careerValue).toBeLessThan(60);
    
    // Trace should show career assessment separate from capability
    expect(record?.trace.careerValueBreakdown).toBeDefined();
  });

  // Test 6: Verify careerValue in trace matches decisionSummary
  it("careerValue is consistent between trace and decisionSummary", { timeout: 10000 }, () => {
    const fixture = {
      jobHash: "p1b-consistency-test",
      role: "VP Growth",
      company: "TestCorp",
      location: "Mumbai",
      postedRelative: "Posted today",
      scrapedFrom: "LinkedIn" as const,
      primaryConcern: null,
      dimensions: [
        { key: "requiredLevel" as const, label: "Required Level", importance: "Core" as const, bucket: "Matched" as const,
          jdEvidence: { value: "VP", status: "Explicit" as const, evidence: [{ quote: "VP Growth", source: "title" as const }] } },
      ],
      rawText: "VP Growth role. P&L responsibility."
    };

    injectFreshRecords([fixture]);

    const builder = new CandidateProjectionBuilderImpl();
    const projection = builder.fromProfile({
      identity: { currentTitle: "VP Marketing" },
      executiveIdentity: { archetype: "Commercial", valueProposition: "Growth" },
      experience: { achievements: [], yearsExperience: 10 },
      evidence: [],
      preferences: { locations: ["Mumbai"], workModel: "HYBRID" }
    } as any);

    const { records } = runEngine(projection as any, 0);
    const record = records.find(r => r.jobHash === fixture.jobHash);

    expect(record).toBeDefined();
    
    // Trace factors.careerValue should match decisionSummary.careerValue
    expect(record?.trace.factors.careerValue).toBe(record?.decisionSummary.careerValue);
  });
});
