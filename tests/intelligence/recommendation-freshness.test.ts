import { afterEach, describe, expect, it, vi } from "vitest";
import type { DatabaseAdapter } from "../../src/data/database/adapter";
import { TenantScopedPersonStore } from "../../src/data/sqlite/repositories/TenantScopedPersonStore";
import {
  compareRecommendationLineage,
  getRecommendationFreshness,
  refreshSavedRecommendations,
} from "@/candidate/recommendation-freshness";

const scope = { tenantId: "tenant_A", personId: "person_A", roles: [] };

function database(activeVersion: string | null, bindingVersion: string | null) {
  const one = vi.fn(async (sql: string, params?: readonly unknown[]) => {
    expect(params?.slice(0, 2)).toEqual([scope.tenantId, scope.personId]);
    if (sql.includes("profile_projection_source_bindings"))
      return bindingVersion ? { profile_version: bindingVersion } : null;
    if (sql.includes("active_evaluation_contexts"))
      return activeVersion ? { profile_version: activeVersion } : null;
    throw new Error("Unexpected query");
  });
  return { one } as unknown as DatabaseAdapter;
}

describe("recommendation profile freshness", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses only the exact immutable profile version and active context lineage", async () => {
    vi.spyOn(TenantScopedPersonStore.prototype, "getLatestProjection").mockResolvedValue({
      profileVersion: "profile-A",
    } as never);
    expect(compareRecommendationLineage("profile-A", "profile-A")).toBe("CURRENT");
    expect(compareRecommendationLineage("profile-B", "profile-A")).toBe("PROFILE_UPDATED");
    expect(compareRecommendationLineage("profile-A", null)).toBe("NO_ACTIVE_CONTEXT");
    expect(
      (await getRecommendationFreshness(database("profile-A", "profile-A"), scope)).state,
    ).toBe("CURRENT");
    expect(
      (await getRecommendationFreshness(database("profile-old", "profile-A"), scope)).state,
    ).toBe("PROFILE_UPDATED");
  });

  it("fails if the latest projection has no bound immutable source", async () => {
    vi.spyOn(TenantScopedPersonStore.prototype, "getLatestProjection").mockResolvedValue({
      profileVersion: "profile-A",
    } as never);
    await expect(getRecommendationFreshness(database("profile-old", null), scope)).rejects.toThrow(
      "PROFILE_BINDING_NOT_FOUND",
    );
  });

  it("refreshes unchanged intent through activation without inserting another intent", async () => {
    vi.spyOn(TenantScopedPersonStore.prototype, "getLatestProjection").mockResolvedValue({
      profileVersion: "profile-B",
    } as never);
    const intent = {
      personId: scope.personId,
      targetTitles: ["VP Growth"],
      preferredLocations: ["Delhi"],
    };
    const activate = vi.fn(async () => ({
      activation: { context: { profileVersion: "profile-B" } },
      coverage: { examined: 1, candidates: 1, materialized: 1 },
    }));
    const result = await refreshSavedRecommendations(database("profile-A", "profile-B"), scope, {
      getSavedIntent: vi.fn(async () => intent),
      activate,
    });
    expect(result.profileVersion).toBe("profile-B");
    expect(activate).toHaveBeenCalledWith(
      expect.objectContaining({ ...intent, scope, activatedBy: "profile-refresh" }),
    );
  });
});
