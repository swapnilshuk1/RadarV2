import { describe, it, expect } from "vitest";
import { CapabilityAssessmentEngine } from "../src/lib/intelligence/engines/CapabilityAssessmentEngine";
import type { CandidateProjection } from "../src/lib/domain/candidate_projection";
import type { JobProjection } from "../src/lib/domain/job_projection";

const COMMERCIAL_EXECUTIVE_CANDIDATE: CandidateProjection = {
  operatingLevel: { value: "EXECUTIVE", confidence: 0.95 },
  decisionAuthority: { value: "ENTERPRISE", confidence: 0.9 },
  commercialScope: { value: "ENTERPRISE", confidence: 0.9 },
  workNature: { value: "HYBRID", confidence: 0.9 },
  yearsOfExperience: 18,
  coreCapabilities: [
    "GTM Strategy",
    "P&L Ownership",
    "Enterprise Growth",
    "Commercial Governance",
    "Digital Marketing Transformation",
    "RevOps & Sales Strategy"
  ],
  preferredLocations: ["Bengaluru", "Mumbai"],
  preferredWorkModel: "HYBRID",
  executiveThemes: ["Commercial & Marketing Leadership", "Enterprise Growth"]
};

function createJobWithCapabilities(capabilities: string[]): JobProjection {
  return {
    jobHash: "test-job-domain-precedence",
    role: "Target Executive Mandate",
    company: "Target Corp",
    executiveIdentity: { value: "Commercial & Marketing Leadership", confidence: 0.9, evidence: [] },
    trueExecutiveMandate: "COMMERCIAL_EXPANSION",
    operatingLevel: { value: "EXECUTIVE", confidence: 0.9 },
    workNature: { value: "HYBRID", confidence: 0.9 },
    decisionAuthority: { value: "ENTERPRISE", confidence: 0.9 },
    commercialScope: { value: "ENTERPRISE", confidence: 0.9 },
    capabilities: capabilities.map((name) => ({
      name,
      importance: "REQUIRED",
      source: "JOB_DESCRIPTION"
    })),
    executiveFunction: ["Executive Leadership"],
    businessObjectives: ["Operations"],
    executionStyle: ["Strategic"],
    operatingContext: { pnlResponsibility: true, budgetOwnership: true },
    location: "Bengaluru",
    workModel: "HYBRID",
    capabilityExtractionStatus: "SUCCESS",
    originalOpportunity: {
      jobHash: "test-job-domain-precedence",
      role: "Target Executive Mandate",
      company: "Target Corp",
      dimensions: [
        { key: "functionalScope", jdEvidence: { value: "Scope", status: "Extracted" } },
        { key: "mandate", jdEvidence: { value: "Mandate", status: "Extracted" } },
        { key: "decisionAuthority", jdEvidence: { value: "ENTERPRISE", status: "Extracted" } },
        { key: "commercialScope", jdEvidence: { value: "ENTERPRISE", status: "Extracted" } }
      ]
    }
  } as any;
}

describe("Phase 1 — Capability Assessment Domain Precedence", () => {
  it("does not match orthogonal non-commercial domains via generic executive keyword shortcut", () => {
    const orthogonalJob = createJobWithCapabilities([
      "Clinical Governance",
      "Hospital Administration",
      "Nuclear Safety Management"
    ]);

    const result = CapabilityAssessmentEngine.evaluate(COMMERCIAL_EXECUTIVE_CANDIDATE, orthogonalJob);

    // None of these orthogonal capabilities should be counted as matched
    expect(result.matchedCapabilities.some(c => c.includes("Clinical Governance"))).toBe(false);
    expect(result.matchedCapabilities.some(c => c.includes("Hospital Administration"))).toBe(false);
    expect(result.matchedCapabilities.some(c => c.includes("Nuclear Safety Management"))).toBe(false);

    // All should be marked as missing
    expect(result.missingCapabilities.some(c => c.includes("Clinical Governance"))).toBe(true);
    expect(result.missingCapabilities.some(c => c.includes("Hospital Administration"))).toBe(true);
    expect(result.missingCapabilities.some(c => c.includes("Nuclear Safety Management"))).toBe(true);

    // Overall fit should be low, not inflated by Step 2 enterprise keyword matches
    expect(result.overallFit).toBeLessThan(0.40);
  });

  it("continues to match genuine commercial and enterprise leadership capabilities", () => {
    const commercialJob = createJobWithCapabilities([
      "GTM Strategy",
      "Commercial Governance",
      "Digital Marketing Transformation"
    ]);

    const result = CapabilityAssessmentEngine.evaluate(COMMERCIAL_EXECUTIVE_CANDIDATE, commercialJob);

    expect(result.matchedCapabilities.some(c => c.includes("GTM Strategy"))).toBe(true);
    expect(result.matchedCapabilities.some(c => c.includes("Commercial Governance"))).toBe(true);
    expect(result.matchedCapabilities.some(c => c.includes("Digital Marketing Transformation"))).toBe(true);
    expect(result.overallFit).toBeGreaterThanOrEqual(0.80);
  });
});
