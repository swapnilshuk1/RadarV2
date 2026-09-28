import { describe, it, expect } from "vitest";
import { dim, type DimensionResult } from "../../src/lib/intelligence/schema";

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

});
