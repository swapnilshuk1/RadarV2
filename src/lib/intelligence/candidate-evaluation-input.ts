import type { CandidateProjection } from "./domain/candidate_projection";
import type { SearchCriteriaPayload } from "./domain/evaluation_context";

/**
 * Evaluation composes two immutable planes:
 * - attained candidate evidence from the context-pinned profile projection;
 * - career intent from the context-pinned search-plan snapshot.
 *
 * Never read "latest" intent here: queued work must retain its original context.
 */
export function candidateProjectionForContext(
  projection: CandidateProjection,
  criteria: SearchCriteriaPayload,
): CandidateProjection {
  const pinnedLocations =
    Array.isArray(criteria.targetLocations) && criteria.targetLocations.length > 0
      ? [...criteria.targetLocations]
      : projection.preferredLocations;

  return {
    ...projection,
    preferredLocations: pinnedLocations,
    preferredWorkModel: criteria.preferredWorkModel ?? projection.preferredWorkModel,
  };
}
