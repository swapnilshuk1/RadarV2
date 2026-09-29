import { describe, expect, it } from "vitest";
import { applyDossierCeiling, corroboratedByDossier, ownershipGuard } from "../../src/pursuit/semantic/engine";
import type { MandateDimension } from "../../src/pursuit/semantic/types";
import type { CandidateClaim } from "../../src/pursuit/types";

const dim = (status: string | null, evidence: string[] = []): MandateDimension => ({
  id: "d",
  kind: "CORE_DOMAIN_DELIVERY",
  scopedDomain: null,
  label: "x",
  requirementClass: "DOMAIN_CRITICAL",
  importance: "REQUIRED",
  sourceText: "x",
  dossierStatus: status,
  dossierEvidence: evidence,
});

const claim = (statement: string, over: Partial<CandidateClaim> = {}): CandidateClaim => ({
  id: "c", statement, claimType: "ACHIEVEMENT", employer: "VML", roleTitle: null,
  metricBaseline: null, metricResult: null, capabilities: [], sourceDocumentId: "doc",
  sourceEvidenceGraphId: "g", sourceFactId: "f", sourceLocator: null, provenance: "SOURCE_BACKED",
  verificationState: "EXTRACTED", confidence: 1, metricLocked: true, ...over,
});

describe("dossier lineage is a ceiling on pursuit mapping", () => {
  it("never upgrades the canonical evaluation judgement", () => {
    expect(applyDossierCeiling(dim("TRANSFERABLE"), "DIRECT")).toBe("ANALOGOUS");
    expect(applyDossierCeiling(dim("ADJACENT"), "DIRECT")).toBe("ADJACENT");
    expect(applyDossierCeiling(dim("NOT_EVIDENCED"), "DIRECT")).toBe("UNSUPPORTED");
    expect(applyDossierCeiling(dim("NOT_EVIDENCED"), "ADJACENT")).toBe("UNSUPPORTED");
  });
  it("keeps weaker pursuit judgements and honours DIRECT", () => {
    expect(applyDossierCeiling(dim("DIRECT"), "ADJACENT")).toBe("ADJACENT");
    expect(applyDossierCeiling(dim("DIRECT"), "DIRECT")).toBe("DIRECT");
  });
  it("drops evidence the evaluation found contradicted", () => {
    expect(applyDossierCeiling(dim("CONTRADICTED"), "ANALOGOUS")).toBe("UNSUPPORTED");
  });
  it("is inert without a linked requirement", () => {
    expect(applyDossierCeiling(dim(null), "DIRECT")).toBe("DIRECT");
  });
  it("recognises ledger claims the dossier cited", () => {
    const d = dim("DIRECT", ["Managed an $8M pure agency fee book across 13 markets"]);
    expect(corroboratedByDossier(d, claim("Managed $8M pure agency fee book across 13 markets"))).toBe(true);
    expect(corroboratedByDossier(d, claim("Implemented Salesforce CDP for dealers"))).toBe(false);
  });
});

describe("DIRECT requires demonstrated ownership, not just attribution", () => {
  it("licenses explicit ownership language", () => {
    expect(ownershipGuard(claim("Led the GCC build-out for 400 staff"))).toBe(true);
    expect(ownershipGuard(claim("Owned the P&L for the India business"))).toBe(true);
  });
  it("refuses participation language even when source-backed", () => {
    expect(ownershipGuard(claim("Supported the GCC transition programme"))).toBe(false);
    expect(ownershipGuard(claim("Contributed to the pricing redesign"))).toBe(false);
    expect(ownershipGuard(claim("Collaborated with Google engineering teams"))).toBe(false);
  });
  it("accepts verbless extracted scope facts only when typed and role-attributed", () => {
    expect(ownershipGuard(claim("$8M pure agency fee book", { roleTitle: "SVP" }))).toBe(true);
    expect(ownershipGuard(claim("$8M pure agency fee book", { roleTitle: null }))).toBe(false);
    expect(
      ownershipGuard(claim("AWS Solutions Architect", { claimType: "TECHNOLOGY", roleTitle: "SVP" })),
    ).toBe(false);
  });
  it("refuses claims that are not source-backed or not attributed", () => {
    expect(ownershipGuard(claim("Led the GCC build-out", { provenance: "DERIVED" }))).toBe(false);
    expect(ownershipGuard(claim("Led the GCC build-out", { employer: null }))).toBe(false);
  });
});
