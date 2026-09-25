import { describe, expect, it } from "vitest";
import { EvidenceExtractionService, CANDIDATE_EVIDENCE_PROMPT_VERSION } from "../../src/lib/intelligence/extraction/EvidenceExtractionService";

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
  it("extracts the full explicit source, including clarifications beyond the old text cap", async()=>{
    const tail="Total tenure spans several sectors; sector tenure is not established.";
    const text="Background. ".repeat(1000)+tail;
    const model={id:"injected",version:"test",async generate(_i:string,input:any){expect(input.documentText).toBe(text);return {facts:[{type:"OTHER",value:tail,sourceSpan:tail,confidence:1,justification:"Explicit scope clarification"}]};}};
    const graph=await new EvidenceExtractionService(model).extract({personId:"person",documentId:"doc",documentHash:"hash",documentText:text});
    expect(graph.facts[0].sourceSpan).toBe(tail);expect(graph.provenance.model).toBe("test");
  });
  it("does not silently replace the explicitly selected model with heuristic evidence",async()=>{
    const failure=new Error("Provider unavailable");
    const model={id:"injected",version:"test",async generate(){throw failure;}};
    await expect(new EvidenceExtractionService(model).extract({personId:"person",documentId:"doc",documentHash:"hash",documentText:"Candidate source"})).rejects.toBe(failure);
  });

});


it("persists the canonical candidate evidence prompt version for Bedrock extraction", async () => {
  const source = "Led enterprise marketing transformation.";
  const model = {
    id: "test-bedrock",
    version: "zai.glm-5",
    configurationFingerprint: "test",
    async generate() {
      return { facts: [{
        type: "ACHIEVEMENT",
        value: "Led enterprise marketing transformation.",
        confidence: 0.95,
        sourceSpan: source,
        justification: "Explicit source statement",
      }] };
    },
  };
  const service = new EvidenceExtractionService(model as any);
  const graph = await service.extract({
    personId: "person-1",
    documentId: "doc-1",
    documentHash: "hash",
    documentText: source,
  });
  expect(graph.provenance.promptVersion).toBe(CANDIDATE_EVIDENCE_PROMPT_VERSION);
});
