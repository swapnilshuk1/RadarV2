import { describe, expect, it } from "vitest";
import { EKBConceptResolver } from "../../src/lib/intelligence/ekb/EKBConceptResolver";
import { OntologyResolver } from "../../src/lib/intelligence/extraction/OntologyResolver";

describe("candidate ontology resolution determinism", () => {
  it("resolves the deterministic EKB synchronously", () => {
    const resolved = EKBConceptResolver.resolveConcept("levelized cost of energy");
    expect(resolved).not.toBeInstanceOf(Promise);
    expect(resolved.resolvedConceptId).toBe("cap_renewable_lcoe");
  });

  it("includes EKB resolutions in the projection input before resolve() returns", () => {
    const result = OntologyResolver.resolve({
      id: "graph-ekb",
      personId: "person-1",
      facts: [{
        id: "fact-lcoe",
        type: "ACHIEVEMENT",
        value: "levelized cost of energy",
        confidence: 0.95,
        sourceSpan: "levelized cost of energy",
        justification: "Explicit source phrase",
      }],
      provenance: {
        documentId: "doc-1",
        documentHash: "hash",
        extractorVersion: "test",
        promptVersion: "test",
        model: "test",
        createdAt: "2026-09-25T00:00:00.000Z",
      },
    });
    expect(result.resolvedCapabilities).toContain("cap_renewable_lcoe");
    expect(result.resolvedClaims).toContainEqual(expect.objectContaining({
      capabilityId: "cap_renewable_lcoe",
      evidenceIds: ["fact-lcoe"],
    }));
  });
});
