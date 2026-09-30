import type { DatabaseAdapter } from "@/data/database/adapter";
import type { AuthorizedPersonScope } from "@/lib/security/auth";
import { TenantScopedPersonStore } from "@/data/sqlite/repositories/TenantScopedPersonStore";
import type { CareerIntentRecord } from "@/data/sqlite/repositories/SqliteDocumentStore";

export type RecommendationFreshness =
  "CURRENT" | "PROFILE_UPDATED" | "NO_ACTIVE_CONTEXT" | "REFRESHING";

export function compareRecommendationLineage(
  latestProfileVersion: string | null,
  activeProfileVersion: string | null,
): RecommendationFreshness {
  if (!activeProfileVersion || !latestProfileVersion) return "NO_ACTIVE_CONTEXT";
  return latestProfileVersion === activeProfileVersion ? "CURRENT" : "PROFILE_UPDATED";
}

export async function getLatestBoundProfileVersion(
  db: DatabaseAdapter,
  scope: AuthorizedPersonScope,
): Promise<string | null> {
  const projection = await new TenantScopedPersonStore(db, scope).getLatestProjection(
    scope.personId,
  );
  if (!projection?.profileVersion) return null;
  const binding = await db.one<{ profile_version: string }>(
    `SELECT profile_version FROM profile_projection_source_bindings
     WHERE tenant_id = ? AND person_id = ? AND profile_version = ? LIMIT 1`,
    [scope.tenantId, scope.personId, projection.profileVersion],
  );
  if (!binding) throw new Error("PROFILE_BINDING_NOT_FOUND");
  return binding.profile_version;
}

export async function getRecommendationFreshness(
  db: DatabaseAdapter,
  scope: AuthorizedPersonScope,
) {
  const [latestProfileVersion, active] = await Promise.all([
    getLatestBoundProfileVersion(db, scope),
    db.one<{ profile_version: string }>(
      `SELECT ec.profile_version FROM active_evaluation_contexts aec
       JOIN evaluation_contexts ec ON ec.context_fingerprint = aec.context_fingerprint
         AND ec.tenant_id = aec.tenant_id AND ec.person_id = aec.person_id
       WHERE aec.tenant_id = ? AND aec.person_id = ? LIMIT 1`,
      [scope.tenantId, scope.personId],
    ),
  ]);
  return {
    state: compareRecommendationLineage(latestProfileVersion, active?.profile_version ?? null),
    latestProfileVersion,
    activeProfileVersion: active?.profile_version ?? null,
  };
}

/** Reuses the canonical activation path without writing another intent version. */
export async function refreshSavedRecommendations(
  db: DatabaseAdapter,
  scope: AuthorizedPersonScope,
  dependencies: {
    getSavedIntent: (scope: AuthorizedPersonScope) => Promise<CareerIntentRecord | undefined>;
    activate: (
      input: CareerIntentRecord & { scope: AuthorizedPersonScope; activatedBy: string },
    ) => Promise<{
      activation: { context: { profileVersion: string } };
      coverage: { examined: number; candidates: number; materialized: number };
    }>;
  },
) {
  const intent = await dependencies.getSavedIntent(scope);
  if (!intent) throw new Error("PROFILE_INTENT_REQUIRED");
  const profileVersion = await getLatestBoundProfileVersion(db, scope);
  if (!profileVersion) throw new Error("PROFILE_REQUIRED");
  const result = await dependencies.activate({ ...intent, scope, activatedBy: "profile-refresh" });
  if (result.activation.context.profileVersion !== profileVersion) {
    throw new Error("PROFILE_LINEAGE_CHANGED_DURING_REFRESH");
  }
  return {
    success: true,
    activationState: "ACTIVE" as const,
    profileVersion,
    coverage: result.coverage,
  };
}
