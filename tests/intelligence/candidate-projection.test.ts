import { describe, it, expect } from "vitest";
import { validateCandidateProjection, type CandidateProjection } from "../../src/lib/domain/candidate_projection";
import { CandidateProjectionBuilderImpl } from "../../src/lib/intelligence/builders/CandidateProjectionBuilder";
import { candidateProfile } from "../../src/data/candidate-profile";
import { CareerAssessmentEngine } from "../../src/lib/intelligence/engines/CareerAssessmentEngine";
import { JobProjectionBuilder } from "../../src/lib/intelligence/builders/JobProjectionBuilder";
import { SqlitePersonStore } from "../../src/data/sqlite/repositories/SqlitePersonStore";
import type { DatabaseAdapter } from "../../src/data/database/adapter";
import { CandidateSeniorityClassifier } from "../../src/lib/intelligence/classifiers/CandidateSeniorityClassifier";
import { TenantScopedPersonStore } from "../../src/data/sqlite/repositories/TenantScopedPersonStore";

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
    expect(canonicalProjection.candidateSeniorityLevel?.value).toBe("VP_FUNCTIONAL");
    expect(canonicalProjection.workNature.value).toBe("EXECUTIVE_WORK");
    expect(canonicalProjection.decisionAuthority.value).toBe("BUSINESS_UNIT");
    expect(canonicalProjection.commercialScope.value).toBe("PORTFOLIO");
    expect(canonicalProjection.yearsOfExperience).toBeGreaterThanOrEqual(15);
    expect(canonicalProjection.coreCapabilities.length).toBeGreaterThan(0);
  });

  it("preserves attained identity and keeps target trajectory separate from current seniority", () => {
    expect(canonicalProjection.attainedTitle).toBe("VP Marketing / Performance CoE Lead");
    expect(canonicalProjection.attainedSeniority).toBe("VP_FUNCTIONAL");
    expect(canonicalProjection.targetTrajectory).toContain("Chief Marketing Officer");
    expect(canonicalProjection.archetype).toBe("Commercial Growth & Transformation");
    expect(canonicalProjection.candidateSeniorityLevel?.evidenceIds.join(" ")).toContain("VP Marketing");
    expect(canonicalProjection.candidateSeniorityLevel?.value).not.toBe("C_SUITE");
  });

  it("does not launder unsupported self-assertions into inferred capabilities", () => {
    expect(canonicalProjection.demonstratedCapabilities).not.toContain("Board Reporting");
    expect(canonicalProjection.inferredCapabilities?.some((item) => item.name === "Board Reporting")).toBe(false);
  });

  it("retains an inferred capability only when it chains to a source quotation", () => {
    const profileWithEvidence = {
      ...candidateProfile,
      evidence: [...candidateProfile.evidence, {
        type: "Board governance",
        proof: "Prepared board reporting and formal governance updates for the executive committee."
      }],
    };
    const projection = builder.fromProfile(profileWithEvidence);
    const boardReporting = projection.inferredCapabilities?.find((item) => item.name === "Board Reporting");

    expect(boardReporting?.confidence).toBeLessThan(1);
    expect(boardReporting?.evidenceIds).toContain(`candidate:profileEvidence:${candidateProfile.evidence.length}`);
    expect(boardReporting?.supportingEvidence[0]).toMatchObject({
      quote: "Prepared board reporting and formal governance updates for the executive committee.",
      relation: "SUPPORTS_INFERENCE"
    });
  });

  it("rebuilds the same profile into the same deterministic projection", () => {
    const rebuilt = builder.fromProfile(candidateProfile);
    expect(rebuilt).toEqual(canonicalProjection);
  });

  it("does not mistake generic leadership or target language for attained C-suite seniority", () => {
    const generic = CandidateSeniorityClassifier.classify(
      "VP Marketing",
      "Senior leadership across a 40-person team; target CMO role and future C-suite pathway"
    );
    expect(generic.value).toBe("VP_FUNCTIONAL");
    expect(CandidateSeniorityClassifier.classify("VP Marketing", "Worked with C-suite stakeholders").value).toBe("VP_FUNCTIONAL");

    const attained = CandidateSeniorityClassifier.classify(
      "Chief Marketing Officer",
      "Currently serving as Chief Marketing Officer"
    );
    expect(attained.value).toBe("C_SUITE");
    expect(attained.evidenceIds.some((id) => id.includes("Chief Marketing Officer"))).toBe(true);
  });

  it("persists the source-grounded title, archetype, and a content-addressed profile version", async () => {
    let savedParams: readonly unknown[] = [];
    const db: DatabaseAdapter = {
      one: async () => ({ id: "person-1" }),
      many: async () => [],
      execute: async (_sql, params = []) => {
        savedParams = params;
        return { rowsAffected: 1 };
      },
      transaction: async (fn) => fn(db)
    };
    const store = new TenantScopedPersonStore(db, { tenantId: "tenant-1", personId: "person-1" });
    await store.saveProjection("person-1", canonicalProjection);

    const projectionJson = String(savedParams[4]);
    const persisted = JSON.parse(projectionJson) as CandidateProjection;
    expect(savedParams[6]).toBe("VP Marketing / Performance CoE Lead");
    expect(savedParams[8]).toBe("Commercial Growth & Transformation");
    expect(persisted.profileVersion).toMatch(/^projection-[a-f0-9]{64}$/);
    expect(persisted.attainedTitle).toBe("VP Marketing / Performance CoE Lead");
  });

  it("builds evidence projections from an observed title instead of a fabricated Executive identity", () => {
    const projection = builder.fromEvidence(
      {
        id: "graph-1",
        personId: "person-1",
        facts: [{
          id: "fact-title",
          type: "EMPLOYMENT",
          value: "VP Growth Marketing",
          confidence: 0.98,
          sourceSpan: "Current role: VP Growth Marketing",
          justification: "Explicit current title"
        }],
        provenance: {
          documentId: "doc-1",
          documentHash: "hash-1",
          extractorVersion: "test",
          promptVersion: "test",
          model: "test",
          createdAt: "2026-09-02T00:00:00.000Z"
        }
      },
      {
        evidenceGraphId: "graph-1",
        resolvedCapabilities: ["Growth Marketing"],
        resolvedClaims: [{ statement: "Growth Marketing", capabilityId: "growth", evidenceIds: ["fact-title"], confidence: 0.98 }],
        resolvedSkills: ["Growth Marketing"],
        ignoredFactsCount: 0,
        unmappedTermsDetected: []
      }
    );

    expect(projection.attainedTitle).toBe("VP Growth Marketing");
    expect(projection.candidateSeniorityLevel?.value).toBe("VP_FUNCTIONAL");
    expect(projection.attainedTitle).not.toBe("Executive");
    expect(projection.yearsOfExperience).toBe(0);
    expect(projection.attainedTitleEvidence).toEqual([expect.objectContaining({ id: "fact-title", relation: "ATTAINED_TITLE" })]);
  });

  it("selects only a current employment fact for attained title and ignores target-role facts", () => {
    const projection = builder.fromEvidence(
      {
        id: "graph-2",
        personId: "person-1",
        facts: [
          {
            id: "target-cmo",
            type: "EMPLOYMENT",
            value: "Target role: Chief Marketing Officer",
            confidence: 1,
            sourceSpan: "Aspiration: Chief Marketing Officer",
            justification: "Career goal"
          },
          {
            id: "current-vp",
            type: "EMPLOYMENT",
            value: "VP Growth Marketing",
            confidence: 0.9,
            sourceSpan: "Current role: VP Growth Marketing",
            justification: "Current employment"
          }
        ],
        provenance: {
          documentId: "doc-2", documentHash: "hash-2", extractorVersion: "test", promptVersion: "test", model: "test", createdAt: "2026-09-02T00:00:00.000Z"
        }
      },
      {
        evidenceGraphId: "graph-2", resolvedCapabilities: [], resolvedClaims: [], resolvedSkills: [], ignoredFactsCount: 0, unmappedTermsDetected: []
      }
    );

    expect(projection.attainedTitle).toBe("VP Growth Marketing");
    expect(projection.attainedSeniority).toBe("VP_FUNCTIONAL");
    expect(projection.attainedTitleEvidence?.[0]?.id).toBe("current-vp");
  });

  it("keeps an evidence-poor projection's themes and archetype unknown rather than fabricating defaults", () => {
    const projection = builder.fromEvidence(
      {
        id: "graph-3", personId: "person-1", facts: [],
        provenance: {
          documentId: "doc-3", documentHash: "hash-3", extractorVersion: "test", promptVersion: "test", model: "test", createdAt: "2026-09-02T00:00:00.000Z"
        }
      },
      {
        evidenceGraphId: "graph-3", resolvedCapabilities: [], resolvedClaims: [], resolvedSkills: [], ignoredFactsCount: 0, unmappedTermsDetected: []
      }
    );

    expect(projection.executiveThemes).toEqual([]);
    expect(projection.archetype).toBeUndefined();
    expect(projection.operatingLevel.value).toBe("UNKNOWN");
    expect(projection.candidateSeniorityLevel?.value).toBe("UNKNOWN");
    expect(projection.decisionAuthority.value).toBe("UNKNOWN");
    expect(projection.commercialScope.value).toBe("UNKNOWN");
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
