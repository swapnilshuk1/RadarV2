import { describe, it, expect } from "vitest";
import { DecisionPolicyEngine } from "../../src/lib/intelligence/policy/DecisionPolicyEngine";
import type { CandidateProjection } from "../../src/lib/domain/candidate_projection";
import type { JobProjection } from "../../src/lib/domain/job_projection";

const BASE_CANDIDATE: CandidateProjection = {
  operatingLevel: { value: "EXECUTIVE", confidence: 0.95 },
  decisionAuthority: { value: "ENTERPRISE", confidence: 0.9 },
  commercialScope: { value: "ENTERPRISE", confidence: 0.9 },
  workNature: { value: "HYBRID", confidence: 0.9 },
  yearsOfExperience: 18,
  coreCapabilities: [
    "GTM Strategy",
    "P&L Ownership",
    "Enterprise Growth",
    "Commercial Governance"
  ],
  preferredLocations: ["Bengaluru", "Mumbai"],
  preferredWorkModel: "HYBRID",
  executiveThemes: ["Commercial & Marketing Leadership"]
};

function createMockOpportunity(options: {
  jobHash: string;
  role: string;
  company: string;
  text: string;
  dimensions: Array<{ key: string; jdEvidence: { value: any; status?: string } }>;
  capabilities?: string[];
}): any {
  return {
    jobHash: options.jobHash,
    role: options.role,
    company: options.company,
    executiveIdentity: "Commercial & Marketing Leadership",
    dimensions: options.dimensions,
    jobDescription: options.text,
    mandateAssessment: { type: "BUSINESS_GROWTH", scope: "ENTERPRISE" },
    operatingLevelAssessment: "MATCH",
    seniorityAssessment: { mandateSeniority: "EXECUTIVE", signalType: "MATCH" },
    identityAssessment: { verdict: "MATCH", coverage: 0.85, evidenceCount: options.dimensions.length },
    capabilityAssessment: {
      status: "EVALUATED",
      overallFit: options.capabilities && options.capabilities.length > 0 ? 0.85 : 0.50,
      matchingConfidence: 0.85,
      evidenceCount: options.dimensions.length,
      matchedCapabilities: options.capabilities || [],
      missingCapabilities: []
    },
    careerAssessment: { regressionScore: 0, trajectory: "FORWARD" },
    lifestyleAssessment: { locationFrictionPenalty: 0 },
    originalOpportunity: {
      jobHash: options.jobHash,
      role: options.role,
      company: options.company,
      dimensions: options.dimensions,
    }
  };
}

function evaluateMockOpp(opp: any, text: string, dimensions: any[], hasStructured = false) {
  return DecisionPolicyEngine.evaluate(
    opp.identityAssessment,
    opp.capabilityAssessment,
    opp,
    opp.careerAssessment,
    opp.lifestyleAssessment,
    "Commercial & Marketing Leadership",
    "Commercial & Marketing Leadership",
    text,
    hasStructured,
    undefined,
    dimensions,
    85 // Authoritative Shortlisting Potential (strong fit)
  );
}

describe("Phase 2 — Overall Evidence Decisionability Gating", () => {
  it("Generic 300-word buzzword JD with zero structural anchors remains non-actionable (NOT_EVALUABLE / SPARSE_SPEC)", () => {
    const buzzwordText = `
      We are looking for a dynamic synergy rockstar leader in a fast-paced environment.
      The ideal candidate will collaborate with cross-functional stakeholders, execute key initiatives,
      drive excellence, and champion team culture. Must have a passion for innovation, strong communication
      skills, problem-solving abilities, and agility to navigate ambiguous landscapes.
    `.repeat(10); // ~300 words of pure buzzwords with 0 structural anchors

    const ungroundedOpp = createMockOpportunity({
      jobHash: "opp-buzzwords-zero-structure",
      role: "VP Marketing",
      company: "BuzzCorp",
      text: buzzwordText,
      dimensions: [] // 0 extracted structural dimensions
    });

    const result = evaluateMockOpp(ungroundedOpp, buzzwordText, []);

    // Must NOT be an actionable CONSIDER or PURSUE
    expect(result.verdict).not.toBe("CONSIDER");
    expect(result.verdict).not.toBe("PURSUE");
    expect(["SPARSE_SPEC", "NOT_EVALUABLE"]).toContain(result.verdict);
    expect(result.qualityScore).toBeNull();
  });

  it("Generic 300-word JD with four low-quality/UNKNOWN extracted dimensions remains non-actionable", () => {
    const buzzwordText = "Dynamic executive leader needed for fast-paced growth and excellence. ".repeat(30);

    const dims = [
      { key: "functionalScope", jdEvidence: { value: "UNKNOWN", status: "Missing" } },
      { key: "mandate", jdEvidence: { value: "UNKNOWN", status: "Missing" } },
      { key: "lifestyle", jdEvidence: { value: "UNKNOWN", status: "Missing" } },
      { key: "operatingLevel", jdEvidence: { value: "UNKNOWN", status: "Missing" } }
    ];

    const fakeDimensionsOpp = createMockOpportunity({
      jobHash: "opp-buzzwords-fake-dims",
      role: "Chief Growth Officer",
      company: "VaporWare Inc",
      text: buzzwordText,
      dimensions: dims
    });

    const result = evaluateMockOpp(fakeDimensionsOpp, buzzwordText, dims);

    expect(result.verdict).not.toBe("CONSIDER");
    expect(result.verdict).not.toBe("PURSUE");
    expect(["SPARSE_SPEC", "NOT_EVALUABLE"]).toContain(result.verdict);
    expect(result.qualityScore).toBeNull();
  });

  it("JD with only 1 structural anchor (below threshold of 2) remains non-actionable", () => {
    const singleAnchorDims = [
      { key: "functionalScope", jdEvidence: { value: "Marketing Leadership", status: "Extracted" } },
      { key: "randomProse", jdEvidence: { value: "Fast paced culture", status: "Extracted" } }
    ];

    const singleAnchorOpp = createMockOpportunity({
      jobHash: "opp-single-anchor",
      role: "VP Marketing",
      company: "SingleAnchor Corp",
      text: "Leading marketing function in dynamic team.",
      dimensions: singleAnchorDims
    });

    const result = evaluateMockOpp(singleAnchorOpp, singleAnchorOpp.jobDescription, singleAnchorDims, false);

    expect(result.verdict).not.toBe("CONSIDER");
    expect(result.verdict).not.toBe("PURSUE");
    expect(["SPARSE_SPEC", "NOT_EVALUABLE"]).toContain(result.verdict);
    expect(result.qualityScore).toBeNull();
  });

  it("Rich structural JD with verified P&L and mandate evaluates to PURSUE when fit is strong", () => {
    const richDims = [
      { key: "functionalScope", jdEvidence: { value: "Commercial & Marketing", status: "Extracted" } },
      { key: "mandate", jdEvidence: { value: "P&L Ownership & GTM Expansion", status: "Extracted" } },
      { key: "operatingLevel", jdEvidence: { value: "EXECUTIVE", status: "Extracted" } },
      { key: "decisionAuthority", jdEvidence: { value: "ENTERPRISE", status: "Extracted" } },
      { key: "commercialScope", jdEvidence: { value: "ENTERPRISE", status: "Extracted" } }
    ];

    const richOpp = createMockOpportunity({
      jobHash: "opp-rich-structured",
      role: "Chief Commercial Officer",
      company: "Enterprise Scale Co",
      text: "Leading $50M ARR commercial division reporting directly to Group CEO. Full P&L ownership of 120-person GTM team.",
      dimensions: richDims,
      capabilities: ["GTM Strategy", "P&L Ownership", "Enterprise Growth"]
    });

    const result = evaluateMockOpp(richOpp, richOpp.jobDescription, richDims, true);

    expect(result.verdict).toBe("PURSUE");
    expect(result.qualityScore).toBeGreaterThanOrEqual(80);
  });
});
