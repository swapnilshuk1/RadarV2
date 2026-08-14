 /**
 * P0-E: Candidate Seniority Invariant
 * 
 * Given: Candidate profiles at different seniority levels (Director / VP / C-Suite)
 * When: CandidateProjectionBuilder builds projection
 * Then: candidateSeniorityLevel.value reflects actual classification
 * 
 * Note: candidateSeniorityLevel is DISTINCT from operatingLevel.
 * - operatingLevel uses MANAGERIAL/STRATEGIC/EXECUTIVE taxonomy (for scoring)
 * - candidateSeniorityLevel uses DIRECTOR/VP_FUNCTIONAL/C_SUITE taxonomy (for seniority matching)
 * 
 * Contract: Both classifiers output is authoritative. No hardcoded overrides.
 */

import { describe, it, expect } from "vitest";
import { CandidateProjectionBuilderImpl } from "@/lib/intelligence/builders/CandidateProjectionBuilder";
describe("P0-E: Candidate Level Invariant", () => {

  const createDirectorProfile = () => ({
      identity: { 
      currentTitle: "Senior Director, Marketing Operations",
      email: "director@test.com"
      },
      executiveIdentity: {
      archetype: "Functional Director",
      valueProposition: "Marketing teams and campaign execution",
      executiveThemes: ["Team Leadership", "Campaign Execution"]
    },
    experience: {
      achievements: ["Built 15-person team", "Delivered $5M campaign"],
      yearsExperience: 10
    },
    evidence: [
      { proof: "10 years in marketing roles", confidence: 0.9 }
    ],
    preferences: { locations: [], workModel: "HYBRID" }
  });

  const createVPProfile = () => ({
    identity: {
      currentTitle: "VP Marketing, Performance",
      email: "vp@test.com"
    },
    executiveIdentity: {
      archetype: "Functional VP",
      valueProposition: "Marketing strategy and performance optimization",
      executiveThemes: ["Growth Marketing", "Performance Marketing", "CRM Strategy"]
    },
    experience: {
      achievements: ["Led $50M P&L", "Built 40-person CoE", "13-market transformation"],
      yearsExperience: 15
    },
    evidence: [
      { proof: "VP-level scope across enterprise", confidence: 0.95 },
      { proof: "Direct board exposure", confidence: 0.9 }
    ],
    preferences: { locations: [], workModel: "HYBRID" }
  });

  const createCSuiteProfile = () => ({
    identity: {
      currentTitle: "Chief Marketing Officer",
      email: "cmo@test.com"
    },
    executiveIdentity: {
      archetype: "Board C-Suite",
      valueProposition: "Enterprise marketing transformation and board governance",
      executiveThemes: ["Enterprise Growth", "Digital Transformation", "Board Strategy"]
    },
    experience: {
      achievements: ["$500M P&L ownership", "Board reporting", "C-suite transformation"],
      yearsExperience: 20
    },
    evidence: [
      { proof: "C-suite executive with board seat", confidence: 0.98 },
      { proof: "Enterprise-wide transformation leader", confidence: 0.95 },
      { proof: "Board-level strategy and governance", confidence: 0.95 }
    ],
    preferences: { locations: [], workModel: "HYBRID" }
  });

  it("Director-level profile produces DIRECTOR candidateSeniorityLevel", () => {
    const builder = new CandidateProjectionBuilderImpl();
    const profile = createDirectorProfile();
    const projection = builder.fromProfile(profile as any);

    // P0-E: candidateSeniorityLevel reflects actual classification
    expect(projection.candidateSeniorityLevel?.value).toBe("DIRECTOR");
    
    // operatingLevel remains independent (uses STRATEGIC/EXECUTIVE taxonomy)
    expect(projection.operatingLevel?.value).toBeDefined();
    expect(["STRATEGIC", "EXECUTIVE", "MANAGERIAL"]).toContain(projection.operatingLevel?.value);
  });

  it("VP-level profile produces VP_FUNCTIONAL candidateSeniorityLevel", () => {
    const builder = new CandidateProjectionBuilderImpl();
    const profile = createVPProfile();
    const projection = builder.fromProfile(profile as any);

    // P0-E: candidateSeniorityLevel reflects actual classification
    expect(projection.candidateSeniorityLevel?.value).toBe("VP_FUNCTIONAL");
    
    // operatingLevel remains independent (uses STRATEGIC/EXECUTIVE taxonomy)
    expect(projection.operatingLevel?.value).toBeDefined();
    expect(["STRATEGIC", "EXECUTIVE", "MANAGERIAL"]).toContain(projection.operatingLevel?.value);
  });

  it("C-Suite-level profile produces C_SUITE candidateSeniorityLevel", () => {
    const builder = new CandidateProjectionBuilderImpl();
    const profile = createCSuiteProfile();
    const projection = builder.fromProfile(profile as any);

    // P0-E: candidateSeniorityLevel reflects actual classification
    expect(projection.candidateSeniorityLevel?.value).toBe("C_SUITE");
    
    // operatingLevel remains independent (uses STRATEGIC/EXECUTIVE taxonomy)
    expect(projection.operatingLevel?.value).toBeDefined();
    expect(["STRATEGIC", "EXECUTIVE", "MANAGERIAL"]).toContain(projection.operatingLevel?.value);
  });

  it("different levels produce different candidateSeniorityLevel values", () => {
    const builder = new CandidateProjectionBuilderImpl();

    const director = builder.fromProfile(createDirectorProfile() as any);
    const vp = builder.fromProfile(createVPProfile() as any);
    const cSuite = builder.fromProfile(createCSuiteProfile() as any);

    // All three candidateSeniorityLevel values must be different
    expect(director.candidateSeniorityLevel?.value).not.toBe(vp.candidateSeniorityLevel?.value);
    expect(vp.candidateSeniorityLevel?.value).not.toBe(cSuite.candidateSeniorityLevel?.value);
    expect(director.candidateSeniorityLevel?.value).not.toBe(cSuite.candidateSeniorityLevel?.value);

    // All three should have the expected seniority values
    expect(director.candidateSeniorityLevel?.value).toBe("DIRECTOR");
    expect(vp.candidateSeniorityLevel?.value).toBe("VP_FUNCTIONAL");
    expect(cSuite.candidateSeniorityLevel?.value).toBe("C_SUITE");
  });

  it("candidateSeniorityLevel evidenceIds reflect actual classification, not hardcoded", () => {
    const builder = new CandidateProjectionBuilderImpl();
    const profile = createVPProfile();
    const projection = builder.fromProfile(profile as any);

    const seniorityEvidenceIds = projection.candidateSeniorityLevel?.evidenceIds || [];
    
    // Must have classifier-derived evidence, not just override
    expect(seniorityEvidenceIds.length).toBeGreaterThan(0);
    expect(seniorityEvidenceIds.some((id: string) => id.includes("vp_functional"))).toBe(true);
  });

  it("operatingLevel and candidateSeniorityLevel are independent dimensions", () => {
    const builder = new CandidateProjectionBuilderImpl();
    const profile = createVPProfile();
    const projection = builder.fromProfile(profile as any);

    // operatingLevel uses its own taxonomy
    expect(["STRATEGIC", "EXECUTIVE", "MANAGERIAL"]).toContain(projection.operatingLevel?.value);
    
    // candidateSeniorityLevel uses separate taxonomy
    expect(projection.candidateSeniorityLevel?.value).toBe("VP_FUNCTIONAL");
    
    // They are different values (demonstrates independence)
    expect(projection.operatingLevel?.value).not.toBe(projection.candidateSeniorityLevel?.value);
  });
});

