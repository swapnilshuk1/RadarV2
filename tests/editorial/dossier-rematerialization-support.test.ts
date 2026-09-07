import { describe, expect, it } from "vitest";
import type { CanonicalDossierPresentationV1 } from "../../src/lib/domain/dossier_presentation";
import {
  parseDossierRematerializationOptions,
  presentationsAreSemanticallyEqual,
  reconstructHistoricalOpportunitySource,
  selectsCanonicalJob,
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
});
