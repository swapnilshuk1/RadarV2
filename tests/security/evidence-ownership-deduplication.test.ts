import { describe, expect, test } from "vitest";
import { reuseEvidenceGraphForOwner } from "../../src/lib/intelligence/pipeline/ProjectionPipeline";
import type { EvidenceGraph } from "../../src/domain/evidence";

describe("candidate evidence deduplication ownership", () => {
  const aliceGraph = {
    id: "graph-alice",
    personId: "alice",
    provenance: { documentId: "alice-cv", extractorVersion: "test", promptVersion: "test", model: "test", createdAt: "2026-01-01" },
    evidence: [],
  } as unknown as EvidenceGraph;

  test("identical Alice/Bob content never reuses Alice-owned evidence for Bob", () => {
    const bobReuse = reuseEvidenceGraphForOwner(aliceGraph, "bob", "bob-cv-same-content");
    expect(bobReuse).toBeUndefined();
  });

  test("same-person reuse stamps a new document without changing candidate ownership", () => {
    const reused = reuseEvidenceGraphForOwner(aliceGraph, "alice", "alice-cv-copy");
    expect(reused).toMatchObject({ personId: "alice", provenance: { documentId: "alice-cv-copy" } });
    expect(reused?.id).not.toBe(aliceGraph.id);
  });
});
