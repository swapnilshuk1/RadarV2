import { describe, it, expect } from "vitest";
import { dim, type DimensionResult } from "../../src/lib/intelligence/schema";
import { playbookNarrative } from "../../src/lib/intelligence/editorial";
import type { OpportunitySource } from "../../src/data/opportunity-fixtures";
import type { RecommendationRecord } from "../../src/lib/intelligence/record";

describe("Schema Contract", () => {
  it("dim() strictly expects a complete OpportunityInput with dimensions", () => {
    // If we pass an object without dimensions, TypeScript should fail if we didn't cast it.
    // The test proves that the function itself operates safely on valid inputs.
    const completeInput = {
      dimensions: [{ key: "requiredLevel", label: "Required Level", importance: "Core", bucket: "Matched", jdEvidence: { status: "Explicit", value: "C-Level", evidence: [] } }] as DimensionResult[]
    };
    const result = dim(completeInput, "requiredLevel");
    expect(result?.jdEvidence.value).toBe("C-Level");
  });

  it("playbookNarrative routes SPARSE_SPEC safely without touching dimensions", () => {
    const incompleteSource = {
      jobHash: "hash123",
      role: "CEO",
      company: "Test Co",
      location: "Remote"
      // Note: intentionally missing dimensions to simulate the cast in EvaluationWorker
    } as unknown as OpportunitySource;

    const sparseRecord: RecommendationRecord = {
      jobHash: "hash123",
      engineVersion: "4.3",
      recommendationVersion: "v1",
      verb: "SPARSE_SPEC",
      qualityScore: null,
      rawScore: 0,
      priority: null,
      vetoed: false,
      vetoReason: null,
      claimPermissions: { allowedClaims: [], explicitUnknowns: [], explicitRisks: [] },
      confidence: 0,
      stability: "Low",
      comparison: { higherThan: [], lowerThan: [] },
      confidences: { recommendation: 0, match: 0, stability: 0 },
      diligenceStatus: "FAILED",
      explanation: { missingEvidence: [], contradictionFlags: [] },
      headspace: { finalVerb: "SPARSE_SPEC", downgraded: false }
    };

    // Should not throw Error: Cannot read properties of undefined (reading 'find')
    const narrative = playbookNarrative(sparseRecord, incompleteSource);
    expect(narrative.recommendationArchetype).toBe("Incomplete Signal");
  });
});
