import { describe, expect, it } from "vitest";
import {
  composeRoleBullets,
  deterministicExecutiveSummary,
  evidenceBlock,
  richestClaimText,
} from "../../src/pursuit/resume-copy";
import type { CandidateClaim } from "../../src/pursuit/types";

const claim = (overrides: Partial<CandidateClaim> = {}): CandidateClaim => ({
  id: "c1",
  statement: "Built a regional programme",
  claimType: "ACHIEVEMENT",
  employer: "Northwind",
  roleTitle: "Vice President",
  metricBaseline: null,
  metricResult: null,
  capabilities: ["Transformation"],
  sourceDocumentId: "doc-1",
  sourceEvidenceGraphId: "graph-1",
  sourceFactId: "fact-1",
  sourceLocator: "Built a regional programme across 13 markets and redesigned the operating model",
  provenance: "SOURCE_BACKED",
  verificationState: "VERIFIED",
  confidence: 1,
  metricLocked: true,
  sourceOrdinal: 3,
  ...overrides,
});

describe("deterministic résumé copy", () => {
  it("restores fuller source wording instead of a short extracted label", () => {
    expect(richestClaimText(claim())).toBe(
      "Built a regional programme across 13 markets and redesigned the operating model",
    );
  });

  it("rehydrates an atomic claim from the bound source document bullet", () => {
    const sourceText = new Map([
      ["doc-1", [
        "### Senior Vice President — VML",
        "- Accountable for commercial performance, including an **$8M fee book** for Ford and a **projected ₹36 Cr retainer** for BMW.",
      ].join("\n")],
    ]);
    const source = claim({
      statement: "Accountable for commercial performance, including an $8M fee book for Ford",
      sourceLocator: "Accountable for commercial performance, including an **$8M fee book** for Ford",
    });
    expect(richestClaimText(source, sourceText)).toBe(
      "Accountable for commercial performance, including an $8M fee book for Ford and a projected ₹36 Cr retainer for BMW.",
    );
  });

  it("never replaces or drops a locked figure when choosing richer source wording", () => {
    const source = claim({
      statement: "Delivered $14M revenue",
      sourceLocator: "Redesigned booking journeys",
    });
    expect(richestClaimText(source)).toBe("Delivered $14M revenue");
  });

  it("builds the editorial summary deterministically from selected evidence", () => {
    const block = evidenceBlock(claim()).bullet;
    const summary = deterministicExecutiveSummary(
      "Commercial Leadership",
      [block],
      ["P&L", "Transformation"],
    );
    expect(summary).toContain("Executive leader whose experience spans commercial leadership.");
    expect(summary).toContain(block.text);
  });

  it("collapses facts extracted from one source passage into one detailed bullet", () => {
    const span =
      "Launched a 40-member CoE and migrated 13 APAC and Middle East markets from legacy systems to Salesforce";
    const a = claim({ id: "a", statement: "Launched a 40-member CoE", sourceLocator: span });
    const b = claim({
      id: "b",
      statement: "13 APAC and Middle East markets",
      sourceLocator: span,
      sourceOrdinal: 4,
    });
    const out = composeRoleBullets([a, b]);
    expect(out.bullets).toHaveLength(1);
    expect(out.bullets[0]!.text).toBe(span + ".");
  });

  it("collapses atomic claims that came from the same original CV bullet", () => {
    const sourceText = new Map([
      ["doc-1", "- Recruited and managed a **40-member CoE**, driving CRM and performance marketing across **13 markets**."],
    ]);
    const a = claim({
      id: "a",
      statement: "Recruited and managed a 40-member CoE",
      sourceLocator: "Recruited and managed a **40-member CoE**",
    });
    const b = claim({
      id: "b",
      statement: "driving CRM and performance marketing across 13 markets",
      sourceLocator: "driving CRM and performance marketing across **13 markets**",
      sourceOrdinal: 4,
    });
    const out = composeRoleBullets([a, b], 6, () => false, sourceText);
    expect(out.bullets).toHaveLength(1);
    expect(out.bullets[0]!.text).toBe(
      "Recruited and managed a 40-member CoE, driving CRM and performance marketing across 13 markets.",
    );
  });

  it("does not weld nearby fragments unless the semantic caller licenses adjacency", () => {
    const a = claim({ id: "a", statement: "Led the regional migration programme to Salesforce", sourceLocator: null });
    const b = claim({ id: "b", statement: "13 APAC and Middle East markets", sourceLocator: null, sourceOrdinal: 4 });
    expect(composeRoleBullets([a, b]).bullets).toHaveLength(2);
    expect(composeRoleBullets([a, b], 6, () => true).bullets[0]!.text).toBe(
      "Led the regional migration programme to Salesforce — 13 APAC and Middle East markets.",
    );
  });
});
