/**
 * P0-D: Capability UNKNOWN Semantics Invariant
 * 
 * Given: jobCapabilities.length === 0
 * When: CapabilityAssessmentEngine evaluates
 * Then: evidenceState = "UNAVAILABLE"
 * And: overallFit = null (not 0.50)
 * And: capabilityPotential = null (not 0.50)
 * 
 * Contract: Unknown capability does NOT become neutral positive.
 */

import { describe, it, expect } from "vitest";
import { CapabilityAssessmentEngine } from "@/lib/intelligence/engines/CapabilityAssessmentEngine";
import { createCandidateAtLevel, CANDIDATE_VP } from "./fixtures/candidate-levels";
import type { JobProjection } from "@/src/domain/job_projection";

const FAKE_JOB_NO_CAPS: JobProjection = {
  jobHash: "p0-no-caps",
  role: "Test Role",
  company: "Test Corp",
  executiveIdentity: { value: "Commercial & Marketing Leadership", confidence: 0.9, evidence: [] },
  trueExecutiveMandate: "COMMERCIAL_EXPANSION",
  executiveMission: {
    intent: "ACCELERATE_GROWTH",
    statement: "Test mission",
    successConditions: []
  },
  operatingLevel: { value: "VP_FUNCTIONAL", confidence: 0.8 },
  workNature: { value: "HYBRID", confidence: 0.9 },
  decisionAuthority: { value: "ENTERPRISE", confidence: 0.8 },
  commercialScope: { value: "ENTERPRISE", confidence: 0.8 },
  capabilities: [],  // EMPTY - this is the test case
  executiveFunction: ["Commercial & Marketing"],
  businessObjectives: ["Growth"],
  executionStyle: ["Delivery"],
  operatingContext: { pnlResponsibility: false, budgetOwnership: false },
  location: "Mumbai",
  workModel: "HYBRID",
  capabilityExtractionStatus: "FAILED",
  originalOpportunity: {
    jobHash: "p0-no-caps",
    role: "Test",
    company: "Test",
    dimensions: []
  }
} as any;

describe("P0-D: Capability UNKNOWN Semantics Invariant", () => {
  it("EMPTY_CAPABILITIES returns evidenceState: UNAVAILABLE", () => {
    const candidate = createCandidateAtLevel("VP");
    const assessment = CapabilityAssessmentEngine.evaluate(candidate, FAKE_JOB_NO_CAPS);

    expect(assessment.status).toBe("FAILED");
    expect(assessment.sufficiency).toBe("INSUFFICIENT");
    expect(assessment.evidenceState).toBe("UNAVAILABLE");
  });

  it("EMPTY_CAPABILITIES overallFit is null (not 0.50)", () => {
    const candidate = createCandidateAtLevel("VP");
    const assessment = CapabilityAssessmentEngine.evaluate(candidate, FAKE_JOB_NO_CAPS);

    expect(assessment.evidenceState).toBe("UNAVAILABLE");
    // FAILS on current code: returns 0.50
    expect(assessment.overallFit).toBeNull();
  });

  it("EMPTY_CAPABILITIES capabilityPotential is null (not 0.50)", () => {
    const candidate = createCandidateAtLevel("VP");
    const assessment = CapabilityAssessmentEngine.evaluate(candidate, FAKE_JOB_NO_CAPS);

    expect(assessment.evidenceState).toBe("UNAVAILABLE");
    // FAILS on current code: returns 0.50
    expect(assessment.capabilityPotential).toBeNull();
  });

  it("UNAVAILABLE does not contribute 0.50 to weighted score", () => {
    // If overallFit were 0.50, it would contribute to policy score calculation
    // as if the candidate had medium-fit capability
    const candidate = createCandidateAtLevel("VP");
    const assessment = CapabilityAssessmentEngine.evaluate(candidate, FAKE_JOB_NO_CAPS);

    expect(assessment.overallFit).not.toBeCloseTo(0.50, 2);  // FAILS: is 0.50
    expect(assessment.overallFit).toBeNull();
  });

  it("sufficient evidence produces numeric overallFit", () => {
    // Sanity: non-empty capabilities SHOULD produce numeric score
    const jobWithCaps = {
      ...FAKE_JOB_NO_CAPS,
      capabilities: [
        { name: "CRM Governance", source: "explicit", confidence: 0.9, tier: "CORE_MANDATE" }
      ]
    };
    
    const candidate = createCandidateAtLevel("VP");
    const assessment = CapabilityAssessmentEngine.evaluate(candidate, jobWithCaps as any);
    
    // With evidence, should produce numeric (may be 0 if no match, but not null)
    expect(assessment.evidenceState).toBe("SUFFICIENT");  // or "PARTIAL"
    expect(typeof assessment.overallFit).toBe("number");
  });
});
