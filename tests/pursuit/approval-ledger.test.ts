import { describe, expect, it } from "vitest";
import { ledgerApprovalBlockers } from "../../src/pursuit/approval";
import type { ArtifactContent, CandidateClaim } from "../../src/pursuit/types";

const claim: CandidateClaim = {
  id: "c1",
  statement: "Grew the agency fee book from $8M to $12M in two years",
  claimType: "ACHIEVEMENT",
  employer: "VML",
  roleTitle: "SVP",
  metricBaseline: null,
  metricResult: null,
  capabilities: [],
  sourceDocumentId: "d",
  sourceEvidenceGraphId: null,
  sourceFactId: null,
  sourceLocator: null,
  provenance: "SOURCE_BACKED",
  verificationState: "VERIFIED",
  confidence: 1,
  metricLocked: true,
};

const resume = (text: string, claimId: string | null = "c1"): ArtifactContent => ({
  kind: "RESUME",
  resume: {
    fullName: "A",
    contactLine: "",
    headline: "Growth leader",
    executiveSummary: "Built client businesses.",
    impactAnchors: [
      { claimId, text, edited: true, provenance: claimId ? "SOURCE_BACKED" : "DERIVED" },
    ],
    roles: [],
    capabilities: [],
  },
});

describe("approval proves figures against the ledger", () => {
  it("accepts unchanged figures", () => {
    expect(ledgerApprovalBlockers(resume("Grew fee book $8M → $12M"), { claims: [claim] })).toEqual(
      [],
    );
  });
  it("blocks an edited $8M → $80M", () => {
    const b = ledgerApprovalBlockers(resume("Grew fee book from $80M to $12M"), {
      claims: [claim],
    });
    expect(b.join(" ")).toMatch(/80m/);
  });
  it("licenses a second quantified claim only when its full assertion is present", () => {
    const companion = { ...claim, id: "c2", statement: "Expanded across 13 markets in 12 months" };
    expect(
      ledgerApprovalBlockers(
        resume(`${claim.statement}, alongside ${companion.statement.toLowerCase()}`),
        {
          claims: [claim, companion],
        },
      ),
    ).toEqual([]);
    expect(
      ledgerApprovalBlockers(
        resume(`${claim.statement}, alongside expanded across 13 markets in 80 months`),
        { claims: [claim, companion] },
      ).join(" "),
    ).toMatch(/80/);
  });
  it("blocks a bullet linked to a claim no longer in the ledger", () => {
    expect(
      ledgerApprovalBlockers(resume("Grew fee book $8M", "gone"), { claims: [claim] }).length,
    ).toBe(1);
  });
  it("blocks unlinked free-text figures absent from the ledger", () => {
    expect(
      ledgerApprovalBlockers(resume("Led a 250-person team", null), { claims: [claim] }).length,
    ).toBe(1);
  });
  it("lets messages cite figures from the role context", () => {
    const msg: ArtifactContent = {
      kind: "MESSAGE",
      message: {
        subject: null,
        targetWords: null,
        body: "Your 40% growth plan and my $12M fee book",
      },
    };
    expect(
      ledgerApprovalBlockers(msg, { claims: [claim], contextText: "targeting 40% growth" }),
    ).toEqual([]);
  });
});
