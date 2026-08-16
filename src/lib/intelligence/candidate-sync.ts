// src/lib/intelligence/candidate-sync.ts

import { getRepositories } from "../../data/sqlite/provider";
import { candidateProfile } from "../../data/candidate-profile";
import type { CandidateProfile } from "../../domain/candidate";
import type { CandidateProjection } from "../domain/candidate_projection";
import { CandidateProjectionBuilderImpl } from "./builders/CandidateProjectionBuilder";
import { validateCandidateProjection } from "../domain/candidate_projection";

/**
 * Explicit synchronization mechanism to compile and persist the canonical
 * CandidateProjection to the database for a target user.
 */
export async function syncCanonicalCandidateProjection(
  personId: string = "swapnil-shukla",
  profile: CandidateProfile = candidateProfile
): Promise<CandidateProjection> {
  const repos = getRepositories();
  const builder = new CandidateProjectionBuilderImpl();
  const projection = builder.fromProfile(profile);

  const validation = validateCandidateProjection(projection);
  if (!validation.valid) {
    throw new Error(
      `[syncCanonicalCandidateProjection] Built projection failed integrity check: missing [${validation.missingFields.join(", ")}]`
    );
  }

  await repos.people.saveProjection(personId, projection);
  return projection;
}
