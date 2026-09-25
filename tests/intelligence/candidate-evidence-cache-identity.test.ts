import { describe, expect, it, vi } from "vitest";
import { SqliteDocumentStore } from "../../src/data/sqlite/repositories/SqliteDocumentStore";
import {
  CANDIDATE_EVIDENCE_EXTRACTOR_VERSION,
  CANDIDATE_EVIDENCE_PROMPT_VERSION,
} from "../../src/lib/intelligence/extraction/EvidenceExtractionService";

describe("candidate evidence cache identity", () => {
  it("requires the current extraction contract and model-backed evidence for authoritative reuse", async () => {
    const one = vi.fn().mockResolvedValue(undefined);
    const store = new SqliteDocumentStore({ one } as any);

    await store.findExistingEvidenceGraphByTextHash("text-hash", "person-1", {
      extractorVersion: CANDIDATE_EVIDENCE_EXTRACTOR_VERSION,
      promptVersion: CANDIDATE_EVIDENCE_PROMPT_VERSION,
      requireModelBacked: true,
    });

    const [sql, params] = one.mock.calls[0];
    expect(sql).toContain("dc.text_hash = ?");
    expect(sql).toContain("eg.person_id = ?");
    expect(sql).toContain("eg.extractor_version = ?");
    expect(sql).toContain("eg.prompt_version = ?");
    expect(sql).toContain("eg.model <> 'heuristic'");
    expect(params).toEqual([
      "text-hash",
      "person-1",
      CANDIDATE_EVIDENCE_EXTRACTOR_VERSION,
      CANDIDATE_EVIDENCE_PROMPT_VERSION,
    ]);
  });

  it("keeps the legacy lookup available when no contract filter is requested", async () => {
    const one = vi.fn().mockResolvedValue(undefined);
    const store = new SqliteDocumentStore({ one } as any);

    await store.findExistingEvidenceGraphByTextHash("text-hash", "person-1");

    const [sql, params] = one.mock.calls[0];
    expect(sql).not.toContain("eg.extractor_version = ?");
    expect(sql).not.toContain("eg.prompt_version = ?");
    expect(sql).not.toContain("eg.model <> 'heuristic'");
    expect(params).toEqual(["text-hash", "person-1"]);
  });
});
