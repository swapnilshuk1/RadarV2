import { describe, expect, it } from "vitest";
import { EvidenceExtractionService } from "../../src/lib/intelligence/extraction/EvidenceExtractionService";

describe("Bedrock candidate extraction grounding", () => {
  it("retains only exact source spans returned by a provider", () => {
    const extractor = new EvidenceExtractionService() as any;
    const rawText = "Led a 40-member cross-functional team across 13 markets.";

    expect(extractor.toExtractedFact({
      type: "LEADERSHIP",
      value: "Led a 40-member cross-functional team",
      confidence: 0.94,
      sourceSpan: "Led a 40-member cross-functional team across 13 markets.",
      justification: "Leadership scope",
    }, rawText, "doc-1", 0)).toMatchObject({
      id: "fact-doc-1-1",
      type: "LEADERSHIP",
      sourceSpan: "Led a 40-member cross-functional team across 13 markets.",
    });

    expect(extractor.toExtractedFact({
      type: "LEADERSHIP",
      value: "Invented scope",
      confidence: 0.9,
      sourceSpan: "Led a team across 20 markets.",
      justification: "Not present",
    }, rawText, "doc-1", 1)).toBeUndefined();
  });
});
