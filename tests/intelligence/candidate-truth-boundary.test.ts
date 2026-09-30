import { describe, expect, it } from "vitest";
import { parseDocumentText } from "../../src/lib/intelligence/extraction/text-parser";
import { reuseEvidenceGraphForOwner } from "@/candidate/pipeline";
import type { EvidenceGraph } from "../../src/domain/evidence";

describe("canonical candidate-truth boundaries", () => {
  it("accepts bounded UTF-8 text and rejects unsupported or invalid binary input", async () => {
    await expect(parseDocumentText(Buffer.from("Candidate evidence"), "text/plain")).resolves.toMatchObject({ rawText: "Candidate evidence" });
    await expect(parseDocumentText(Buffer.from([0xff, 0xfe]), "text/plain")).rejects.toThrow();
    await expect(parseDocumentText(Buffer.from("not a resume"), "application/msword")).rejects.toThrow("DOCUMENT_FORMAT_UNSUPPORTED");
  });

  it("does not treat a heuristic graph as reusable canonical evidence", () => {
    const heuristic = { id: "heuristic", personId: "person_A", provenance: { documentId: "doc_A", model: "heuristic" } } as EvidenceGraph;
    expect(reuseEvidenceGraphForOwner(heuristic, "person_A", "doc_B")).toBeUndefined();
  });

  it("keeps model-backed reuse bound to the candidate and replacement document", () => {
    const graph = { id: "model", personId: "person_A", provenance: { documentId: "doc_A", model: "bedrock" } } as EvidenceGraph;
    expect(reuseEvidenceGraphForOwner(graph, "person_B", "doc_B")).toBeUndefined();
    expect(reuseEvidenceGraphForOwner(graph, "person_A", "doc_B")).toMatchObject({ personId: "person_A", provenance: { documentId: "doc_B" } });
  });
});
