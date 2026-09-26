// src/lib/intelligence/candidate-sync.ts

import type { CandidateProfile } from "../../domain/candidate";
import type { CandidateProjection } from "../domain/candidate_projection";
import { CandidateProjectionBuilderImpl } from "./builders/CandidateProjectionBuilder";
import { validateCandidateProjection } from "../domain/candidate_projection";
import type { AuthorizedPersonScope } from "../security/auth";
import { TenantScopedPersonStore } from "../../data/sqlite/repositories/TenantScopedPersonStore";
import { getDatabaseAdapter } from "../../data/database";

/**
 * Explicit synchronization mechanism to compile and persist the canonical
 * CandidateProjection to the database for a target user.
 */
export async function syncCanonicalCandidateProjection(
  scope: AuthorizedPersonScope,
  profile: CandidateProfile,
): Promise<CandidateProjection> {
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(profile);

  const validation = validateCandidateProjection(projection);
  if (!validation.valid) {
    throw new Error(
      `[syncCanonicalCandidateProjection] Built projection failed integrity check: missing [${validation.missingFields.join(", ")}]`
    );
  }

  await new TenantScopedPersonStore(getDatabaseAdapter(), scope).saveProjection(scope.personId, projection);
  return projection;
}
