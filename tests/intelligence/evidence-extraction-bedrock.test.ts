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
  it("enforces intentional 10k character cap when passing source to provider", async () => {
    const text = "A".repeat(15000);
    const span = "A".repeat(10);
    let capturedText = "";
    const model = {
      id: "injected",
      version: "test",
      async generate(_i: string, input: any) {
        capturedText = input.documentText;
        return {
          facts: [{
            type: "OTHER",
            value: span,
            sourceSpan: span,
            confidence: 1,
            justification: "test",
          }],
        };
      },
    };
    await new EvidenceExtractionService(model).extract({
      personId: "person",
      documentId: "doc",
      documentHash: "hash",
      documentText: text,
    });
    expect(capturedText).toHaveLength(10000);
    expect(capturedText).toBe("A".repeat(10000));
  });
  it("does not silently replace the explicitly selected model with heuristic evidence",async()=>{
    const failure=new Error("Provider unavailable");
    const model={id:"injected",version:"test",async generate(){throw failure;}};
    await expect(new EvidenceExtractionService(model).extract({personId:"person",documentId:"doc",documentHash:"hash",documentText:"Candidate source"})).rejects.toBe(failure);
  });

});
