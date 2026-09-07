import { describe, expect, it } from "vitest";
import type { CandidateProjection } from "../../src/lib/domain/candidate_projection";
import {
  deriveCandidateProjectionVersion,
  resolveExactCandidateProjection,
  resolveExactCandidateProjectionForScope,
  versionCandidateProjection,
} from "../../src/data/sqlite/repositories/profile-projection-version";

const legacyProjection: CandidateProjection = {
  operatingLevel: { value: "STRATEGIC", confidence: 1, evidenceIds: [] },
  workNature: { value: "STRATEGIC_WORK", confidence: 1, evidenceIds: [] },
  decisionAuthority: { value: "ENTERPRISE", confidence: 1, evidenceIds: [] },
  commercialScope: { value: "ENTERPRISE", confidence: 1, evidenceIds: [] },
  yearsOfExperience: 20,
  coreCapabilities: ["COMMERCIAL_GROWTH"],
  preferredLocations: ["Gurugram"],
  preferredWorkModel: "HYBRID",
  executiveThemes: ["growth"],
};

describe("legacy candidate projection version compatibility", () => {
  it("derives a stable content version without trusting a supplied version", () => {
    const first = deriveCandidateProjectionVersion(legacyProjection);
    const second = deriveCandidateProjectionVersion({ ...legacyProjection, profileVersion: "legacy-a" });
    const third = deriveCandidateProjectionVersion({ ...legacyProjection, profileVersion: "legacy-b" });
    expect(first).toMatch(/^projection-[a-f0-9]{64}$/);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it("is insensitive to object key order and changes when meaningful content changes", () => {
    const reordered = JSON.parse(JSON.stringify({
      executiveThemes: legacyProjection.executiveThemes,
      preferredWorkModel: legacyProjection.preferredWorkModel,
      preferredLocations: legacyProjection.preferredLocations,
      coreCapabilities: legacyProjection.coreCapabilities,
      yearsOfExperience: legacyProjection.yearsOfExperience,
      commercialScope: legacyProjection.commercialScope,
      decisionAuthority: legacyProjection.decisionAuthority,
      workNature: legacyProjection.workNature,
      operatingLevel: legacyProjection.operatingLevel,
    })) as CandidateProjection;
    expect(deriveCandidateProjectionVersion(reordered)).toBe(deriveCandidateProjectionVersion(legacyProjection));
    expect(deriveCandidateProjectionVersion({ ...legacyProjection, yearsOfExperience: 21 }))
      .not.toBe(deriveCandidateProjectionVersion(legacyProjection));
  });

  it("accepts only the exact context-pinned legacy projection, never a newer wrong row", () => {
    const expected = deriveCandidateProjectionVersion(legacyProjection);
    const wrong = { ...legacyProjection, yearsOfExperience: 21 };
    const resolved = resolveExactCandidateProjection(
      [JSON.stringify(wrong), JSON.stringify(legacyProjection)], expected,
    );
    expect(resolved?.profileVersion).toBe(expected);
    expect(resolveExactCandidateProjection([JSON.stringify(wrong)], expected)).toBeUndefined();
  });

  it("attaches a derived version in memory for a legacy projection while retaining supplied canonical versions", () => {
    expect(versionCandidateProjection(legacyProjection).profileVersion).toBe(deriveCandidateProjectionVersion(legacyProjection));
    expect(versionCandidateProjection({ ...legacyProjection, profileVersion: "projection-existing" }).profileVersion).toBe("projection-existing");
  });

  it("treats a stored profileVersion as explicit provenance instead of deriving around a mismatch", () => {
    const expected = deriveCandidateProjectionVersion(legacyProjection);
    expect(resolveExactCandidateProjection([
      JSON.stringify({ ...legacyProjection, profileVersion: "projection-explicit-other" }),
    ], expected)).toBeUndefined();
    expect(resolveExactCandidateProjection([
      JSON.stringify({ ...legacyProjection, profileVersion: "projection-explicit-match" }),
    ], "projection-explicit-match")?.profileVersion).toBe("projection-explicit-match");
  });

  it("requires person ownership before examining a scoped exact projection", async () => {
    const expected = deriveCandidateProjectionVersion(legacyProjection);
    const adapter = {
      one: async <T>() => ({ id: "person-a" } as T),
      many: async <T>() => ([{ projection_json: JSON.stringify(legacyProjection) }] as T[]),
    } as any;
    await expect(resolveExactCandidateProjectionForScope(adapter, {
      tenantId: "tenant-a", personId: "person-a",
    }, expected)).resolves.toMatchObject({ profileVersion: expected });

    const unauthorized = { ...adapter, one: async () => null };
    await expect(resolveExactCandidateProjectionForScope(unauthorized, {
      tenantId: "tenant-b", personId: "person-a",
    }, expected)).resolves.toBeUndefined();
  });
});
