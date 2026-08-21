import { describe, it, expect } from "vitest";
import { CareerAssessmentEngine } from "../../src/lib/intelligence/engines/CareerAssessmentEngine";
import type { CandidateProjection } from "../../src/domain/candidate_projection";
import type { JobProjection } from "../../src/domain/job_projection";

describe("Phase 4 — Fallback Semantics Verification Audit", () => {
  const baseCandidate: CandidateProjection = {
    canonicalId: "cand-1",
    name: "Executive Candidate",
    operatingLevel: { value: "EXECUTIVE", confidence: 0.95 },
    executiveThemes: ["Commercial & Marketing Leadership"],
    mandatePreferences: ["BUSINESS_GROWTH"],
    commercialScale: { value: 1.0, confidence: 0.9 },
    scopeExpansion: { value: 1.0, confidence: 0.9 },
    trajectoryVelocity: { value: 1.0, confidence: 0.9 }
  };

  const createJob = (level: any): JobProjection => ({
    jobHash: "job-audit-level",
    role: "VP Marketing",
    company: "AuditCorp",
    operatingLevel: { value: level, confidence: 0.9 },
    executiveIdentity: { value: "Commercial & Marketing Leadership", confidence: 0.9 },
    operatingContext: { pnlResponsibility: true, directReports: true },
    commercialScale: { value: 1.0, confidence: 0.9 },
    scopeExpansion: { value: 1.0, confidence: 0.9 },
    originalOpportunity: {
      canonicalTitle: "VP Marketing",
      companyName: "AuditCorp",
      location: "Bengaluru",
      dimensions: [
        { key: "functionalScope", jdEvidence: { value: "Marketing", status: "Extracted" } },
        { key: "operatingLevel", jdEvidence: { value: level, status: "Extracted" } },
        { key: "mandate", jdEvidence: { value: "Growth", status: "Extracted" } }
      ]
    }
  });

  it("Unknown/missing operating level fails cleanly with UNKNOWN_OPERATING_LEVEL and does not assume 0 regression", () => {
    const job = createJob("UNKNOWN");
    const result = CareerAssessmentEngine.evaluate(baseCandidate, job);

    expect(result.status).toBe("FAILED");
    expect(result.failureCode).toBe("UNKNOWN_OPERATING_LEVEL");
    expect(result.regressionScore).toBe(100);
  });

  it("Executive to Managerial correctly detects 2-level regression penalty", () => {
    const job = createJob("MANAGERIAL");
    const result = CareerAssessmentEngine.evaluate(baseCandidate, job);

    expect(result.status).toBe("COMPLETE");
    // Diff is 5 - 3 = 2 -> titleRegressionRisk = 30
    expect(result.careerRisk).toBeGreaterThanOrEqual(30);
  });

  it("Executive to Executive computes lateral trajectory without title regression penalty", () => {
    const job = createJob("EXECUTIVE");
    const result = CareerAssessmentEngine.evaluate(baseCandidate, job);

    expect(result.status).toBe("COMPLETE");
    expect(result.trajectory).toBe("FORWARD");
  });
});
