import { createServerFn } from "@tanstack/react-start";
import { getRepositories } from "../../data/sqlite/provider";
import { requireAuthUser } from "../auth/guard";
import { resolveScope } from "./opportunity-service";

type CandidateScopeRequest = { tenantId?: string; personId?: string };
function requestedScope(data?: CandidateScopeRequest) {
  if (Boolean(data?.tenantId) !== Boolean(data?.personId)) throw new Error("CANDIDATE_SCOPE_INCOMPLETE");
  return data;
}

export const getDecisionsFn = createServerFn({ method: "GET" }).validator((data?: CandidateScopeRequest) => data).handler(async ({ data }) => {
  const user = await requireAuthUser();
  const requested = requestedScope(data);
  const scope = await resolveScope(user.id, requested?.tenantId, requested?.personId);
  const repos = getRepositories();
  const map = await repos.decisions.getUserDecisions(scope.personId, scope.tenantId);
  return {
    success: true,
    decisions: map,
    // Browser cache namespacing only. The server remains the sole canonical
    // decision authority and never accepts automatic browser-cache imports.
    cacheScope: `${scope.tenantId}:${scope.personId}`,
  };
});

export const saveDecisionFn = createServerFn({ method: "POST" })
  .validator((d: { jobHash: string; verb: string; reason?: string; reviewedFingerprint?: string | null } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    if (data.verb !== "PURSUE" && data.verb !== "CONSIDER" && data.verb !== "PASS") {
      throw new Error(`INVALID_DECISION_VERB: ${data.verb}`);
    }
    const user = await requireAuthUser();
    const requested = requestedScope(data);
    const scope = await resolveScope(user.id, requested?.tenantId, requested?.personId, "write:person");
    const repos = getRepositories();
    const acknowledgement = await repos.decisions.recordAuthorizedUserDecision(
      scope.personId,
      scope.tenantId,
      data.jobHash,
      data.verb,
      data.reason,
    );
    return { success: true, reviewedFingerprint: acknowledgement.reviewedFingerprint };
  });

export const undoDecisionFn = createServerFn({ method: "POST" })
  .validator((d: { jobHash: string } & CandidateScopeRequest) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const requested = requestedScope(data);
    const scope = await resolveScope(user.id, requested?.tenantId, requested?.personId, "write:person");
    const repos = getRepositories();
    await repos.decisions.deleteUserDecision(scope.personId, data.jobHash, scope.tenantId);
    return { success: true };
  });

export const clearDecisionsFn = createServerFn({ method: "POST" }).validator((data?: CandidateScopeRequest) => data).handler(async ({ data }) => {
  const user = await requireAuthUser();
  const requested = requestedScope(data);
  const scope = await resolveScope(user.id, requested?.tenantId, requested?.personId, "write:person");
  const repos = getRepositories();
  await repos.decisions.clearUserDecisions(scope.personId, scope.tenantId);
  return { success: true };
});
