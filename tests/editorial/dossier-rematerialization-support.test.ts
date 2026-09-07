import { describe, expect, it } from "vitest";
import type { CanonicalDossierPresentationV1 } from "../../src/lib/domain/dossier_presentation";
import {
  parseDossierRematerializationOptions,
  presentationsAreSemanticallyEqual,
  reconstructHistoricalOpportunitySource,
  selectsCanonicalJob,
  attemptDossierPresentationWrite,
  hasCanonicalReconstructionParity,
} from "../../src/lib/intelligence/dossier/rematerialization-support";

function presentation(overrides: Partial<CanonicalDossierPresentationV1> = {}): CanonicalDossierPresentationV1 {
  return {
    schemaVersion: "dossier-v1",
    generatedAt: "2026-09-01T00:00:00.000Z",
    evaluatedAt: "2026-08-31T00:00:00.000Z",
    evaluationInputHash: "input-1",
    brief: { headline: "Recorded assessment" },
    jobProjection: { role: "Director" },
    executionPackage: { strategy: "Recorded strategy" },
    rawDimensions: [{ key: "functionalScope" }],
    focusTopic: "Marketing",
    whyRoleExists: "Published scope",
    ...overrides,
  };
}

describe("dossier rematerialization operator safety", () => {
  const scope = { tenantId: "tenant-a", personId: "person-a" };
  const row = (canonicalJobId: string) => ({
    id: `row-${canonicalJobId}`,
    canonicalJobId,
    opportunityVersion: `version-${canonicalJobId}`,
    evaluationFingerprint: "input-1",
    decision: "PURSUE",
    qualityScore: 72,
    evaluationJson: JSON.stringify({ decision: "PURSUE", score: 72, evaluationInputHash: "input-1", dossierPresentation: { prior: true } }),
  });
  const recorder = (rowsAffected = 1) => {
    const calls: Array<{ sql: string; params: readonly unknown[] | undefined }> = [];
    return { calls, db: { execute: async (sql: string, params?: readonly unknown[]) => {
      calls.push({ sql, params }); return { rowsAffected };
    } } };
  };
  it("treats generatedAt-only changes as current while preserving every other field", () => {
    expect(presentationsAreSemanticallyEqual(
      presentation(),
      presentation({ generatedAt: "2026-09-02T00:00:00.000Z" }),
    )).toBe(true);
    expect(presentationsAreSemanticallyEqual(
      presentation(),
      presentation({ evaluatedAt: "2026-09-02T00:00:00.000Z" }),
    )).toBe(false);
    expect(presentationsAreSemanticallyEqual(
      presentation(),
      presentation({ brief: { headline: "Current partial assessment" } }),
    )).toBe(false);
  });

  it("reconstructs a historical plain-text JD with the EvaluationWorker-compatible source shape", () => {
    const source = reconstructHistoricalOpportunitySource({
      canonicalJobId: "canonical-1",
      rawContent: "Published role description",
      jobTitle: "Director of Marketing",
      companyName: "Example Co",
      location: "Gurugram",
    });
    expect(source).toMatchObject({
      jobHash: "canonical-1",
      role: "Director of Marketing",
      company: "Example Co",
      location: "Gurugram",
      rawDescription: "Published role description",
    });
  });

  it("keeps stale refresh dry by default and refuses an unscoped stale apply", () => {
    expect(parseDossierRematerializationOptions(["--refresh-stale"])).toMatchObject({
      apply: false,
      refreshStale: true,
      selector: null,
    });
    expect(() => parseDossierRematerializationOptions(["--refresh-stale", "--apply"])).toThrow(/requires/);
  });

  it("requires an explicit stale apply selector and selects only its canonical job", () => {
    const selected = parseDossierRematerializationOptions([
      "--refresh-stale", "--apply", "--canonical-job-id=canonical-1",
    ]);
    expect(selectsCanonicalJob(selected.selector, "canonical-1")).toBe(true);
    expect(selectsCanonicalJob(selected.selector, "canonical-2")).toBe(false);
    expect(parseDossierRematerializationOptions(["--refresh-stale", "--apply", "--all"]).selector).toEqual({ kind: "all" });
    expect(() => parseDossierRematerializationOptions([
      "--refresh-stale", "--apply", "--all", "--canonical-job-id=canonical-1",
    ])).toThrow(/exactly one/);
  });

  it("keeps refresh-stale dry runs write-free", async () => {
    const target = recorder();
    const options = parseDossierRematerializationOptions(["--refresh-stale"]);
    const result = await attemptDossierPresentationWrite(options, "STALE", target.db, scope, row("A"), { fresh: true });
    expect(result).toEqual({ eligible: false, updated: 0, casMiss: 0 });
    expect(target.calls).toHaveLength(0);
  });

  it("scopes every refresh apply classification to its single canonical target", async () => {
    const target = recorder();
    const options = parseDossierRematerializationOptions(["--refresh-stale", "--apply", "--canonical-job-id=A"]);
    expect((await attemptDossierPresentationWrite(options, "STALE", target.db, scope, row("A"), { fresh: "A" })).updated).toBe(1);
    expect((await attemptDossierPresentationWrite(options, "STALE", target.db, scope, row("B"), { fresh: "B" })).eligible).toBe(false);
    expect((await attemptDossierPresentationWrite(options, "MISSING_OR_INVALID_RECONSTRUCTABLE", target.db, scope, row("C"), { fresh: "C" })).eligible).toBe(false);
    expect(target.calls).toHaveLength(1);
  });

  it("permits every otherwise-safe refresh classification only with --all", async () => {
    const target = recorder();
    const options = parseDossierRematerializationOptions(["--refresh-stale", "--apply", "--all"]);
    for (const [classification, id] of [["STALE", "A"], ["STALE", "B"], ["MISSING_OR_INVALID_RECONSTRUCTABLE", "C"]] as const) {
      expect((await attemptDossierPresentationWrite(options, classification, target.db, scope, row(id), { fresh: id })).updated).toBe(1);
    }
    expect(target.calls).toHaveLength(3);
  });

  it("refuses canonical decision, score, and fingerprint mismatches before write eligibility", () => {
    const persisted = "input-1";
    const canonical = { decision: "PURSUE", qualityScore: 72, evaluationFingerprint: "input-1" };
    expect(hasCanonicalReconstructionParity(persisted, canonical, { decision: "PURSUE", score: 72, evaluationInputHash: "input-1" })).toBe(true);
    expect(hasCanonicalReconstructionParity(persisted, canonical, { decision: "PASS", score: 72, evaluationInputHash: "input-1" })).toBe(false);
    expect(hasCanonicalReconstructionParity(persisted, canonical, { decision: "PURSUE", score: 71, evaluationInputHash: "input-1" })).toBe(false);
    expect(hasCanonicalReconstructionParity("different", canonical, { decision: "PURSUE", score: 72, evaluationInputHash: "input-1" })).toBe(false);
  });

  it("never writes current presentations and reports one CAS miss without retry", async () => {
    const current = recorder();
    const options = parseDossierRematerializationOptions(["--refresh-stale", "--apply", "--all"]);
    expect(await attemptDossierPresentationWrite(options, "CURRENT", current.db, scope, row("A"), { fresh: true })).toEqual({ eligible: false, updated: 0, casMiss: 0 });
    expect(current.calls).toHaveLength(0);
    const miss = recorder(0);
    expect(await attemptDossierPresentationWrite(options, "STALE", miss.db, scope, row("A"), { fresh: true })).toEqual({ eligible: true, updated: 0, casMiss: 1 });
    expect(miss.calls).toHaveLength(1);
  });

  it("CAS mutation replaces dossierPresentation only and predicates every canonical scalar", async () => {
    const target = recorder();
    const options = parseDossierRematerializationOptions(["--refresh-stale", "--apply", "--all"]);
    await attemptDossierPresentationWrite(options, "STALE", target.db, scope, row("A"), { fresh: "new" });
    const call = target.calls[0]!;
    const after = JSON.parse(String(call.params?.[0]));
    expect(after).toEqual({ decision: "PURSUE", score: 72, evaluationInputHash: "input-1", dossierPresentation: { fresh: "new" } });
    expect(call.sql).toContain("SET evaluation_json = ?");
    expect(call.sql).not.toContain("SET decision");
    expect(call.sql).toContain("evaluation_fingerprint = ?");
    expect(call.sql).toContain("decision IS ? AND quality_score IS ?");
  });
});
