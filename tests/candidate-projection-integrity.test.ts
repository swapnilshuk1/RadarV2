import { describe, it, expect } from "vitest";
import { validateCandidateProjection, type CandidateProjection } from "../src/lib/domain/candidate_projection";
import { CandidateProjectionBuilderImpl } from "../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../src/data/candidate-profile";
import { CareerAssessmentEngine } from "../src/lib/intelligence/engines/CareerAssessmentEngine";
import { JobProjectionBuilder } from "../src/lib/intelligence/builders/JobProjectionBuilder";
import { SqlitePersonStore } from "../src/data/sqlite/repositories/SqlitePersonStore";
import type { DatabaseAdapter } from "../src/data/database/adapter";

describe("Candidate Projection Integrity & Parity", () => {
  const builder = new CandidateProjectionBuilderImpl();
  const canonicalProjection = builder.fromProfile(candidateProfile);

  const sampleRawJob = {
    jobHash: "j-test-vp-growth",
    role: "VP Growth & Marketing",
    company: "Acme Enterprise",
    location: "Gurugram, India (Hybrid)",
    rawText: "Looking for an experienced VP Growth to lead commercial strategy, brand positioning, and enterprise P&L expansion.",
    dimensions: [
      {
        key: "requiredLevel",
        label: "Required Level",
        importance: "Core",
        bucket: "Matched",
        jdEvidence: {
          value: "VP",
          status: "Explicit",
          evidence: [{ quote: "VP Growth", source: "title" }],
          provenance: "explicit",
          quality: "high",
          extractorId: "requiredLevel@1.0.0"
        }
      }
    ]
  };

  it("identifies incomplete or legacy projections with missing operatingLevel", () => {
    const legacyStub = {
      yearsOfExperience: 20,
      coreCapabilities: ["Growth Marketing"],
      preferredLocations: ["Gurugram"],
      preferredWorkModel: "HYBRID",
      executiveThemes: ["Growth"]
      // operatingLevel, workNature, decisionAuthority, commercialScope missing
    };

    const result = validateCandidateProjection(legacyStub);
    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain("operatingLevel");
    expect(result.missingFields).toContain("workNature");
    expect(result.missingFields).toContain("decisionAuthority");
    expect(result.missingFields).toContain("commercialScope");
  });

  it("validates that canonical CandidateProjection has all 9 required fields", () => {
    const result = validateCandidateProjection(canonicalProjection);
    expect(result.valid).toBe(true);
    expect(result.missingFields).toHaveLength(0);
    expect(canonicalProjection.operatingLevel.value).toBe("STRATEGIC");
    expect(canonicalProjection.candidateSeniorityLevel?.value).toBe("C_SUITE");
    expect(canonicalProjection.workNature.value).toBe("EXECUTIVE_WORK");
    expect(canonicalProjection.decisionAuthority.value).toBe("ENTERPRISE");
    expect(canonicalProjection.commercialScope.value).toBe("ENTERPRISE");
    expect(canonicalProjection.yearsOfExperience).toBeGreaterThanOrEqual(15);
    expect(canonicalProjection.coreCapabilities.length).toBeGreaterThan(0);
  });

  it("CareerAssessmentEngine succeeds with canonical projection without tripping UNKNOWN_OPERATING_LEVEL", () => {
    const jobProj = JobProjectionBuilder.build(sampleRawJob as any);
    const careerAssessment = CareerAssessmentEngine.evaluate(canonicalProjection, jobProj);

    expect(careerAssessment.status).not.toBe("FAILED");
    expect(careerAssessment.trajectory).toBeDefined();
    expect(careerAssessment.growthPotential).toBeDefined();
    expect(careerAssessment.failureCode).toBeUndefined();
  });

  it("CareerAssessmentEngine fails when operatingLevel is missing or UNKNOWN", () => {
    const brokenProjection: CandidateProjection = {
      ...canonicalProjection,
      operatingLevel: { value: "UNKNOWN" as any, evidenceIds: [], confidence: 0 }
    };

    const jobProj = JobProjectionBuilder.build(sampleRawJob as any);
    const careerAssessment = CareerAssessmentEngine.evaluate(brokenProjection, jobProj);

    expect(careerAssessment.status).toBe("FAILED");
    expect(careerAssessment.failureCode).toBe("UNKNOWN_OPERATING_LEVEL");
  });

  it("SqlitePersonStore.getLatestProjection returns undefined when stored JSON fails integrity validation", async () => {
    const mockDb: DatabaseAdapter = {
      one: async () => ({
        projection_json: JSON.stringify({
          yearsOfExperience: 20
          // Missing operatingLevel and other fields
        })
      }),
      many: async () => [],
      execute: async () => ({ rowsAffected: 1 }),
      transaction: async (fn) => fn(mockDb)
    };

    const store = new SqlitePersonStore(mockDb);
    const proj = await store.getLatestProjection("test-user");
    expect(proj).toBeUndefined();
  });

  it("SqlitePersonStore.getLatestProjection returns valid CandidateProjection when stored JSON is canonical", async () => {
    const mockDb: DatabaseAdapter = {
      one: async () => ({
        projection_json: JSON.stringify(canonicalProjection)
      }),
      many: async () => [],
      execute: async () => ({ rowsAffected: 1 }),
      transaction: async (fn) => fn(mockDb)
    };

    const store = new SqlitePersonStore(mockDb);
    const proj = await store.getLatestProjection("test-user");
    expect(proj).toBeDefined();
    expect(proj?.operatingLevel.value).toBe("STRATEGIC");
  });
});
