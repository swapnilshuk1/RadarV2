import { createServerFn } from "@tanstack/react-start";
import { getRepositories } from "../../data/sqlite/provider";
import { requireAuthUser } from "../auth/guard";
import { resolveScope } from "./opportunity-service";

export const getDecisionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuthUser();
  const scope = await resolveScope(user.id);
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
  .validator((d: { jobHash: string; verb: string; reason?: string; reviewedFingerprint?: string | null }) => d)
  .handler(async ({ data }) => {
    if (data.verb !== "PURSUE" && data.verb !== "CONSIDER" && data.verb !== "PASS") {
      throw new Error(`INVALID_DECISION_VERB: ${data.verb}`);
    }
    const user = await requireAuthUser();
    const scope = await resolveScope(user.id);
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
  .validator((d: { jobHash: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = await resolveScope(user.id);
    const repos = getRepositories();
    await repos.decisions.deleteUserDecision(scope.personId, data.jobHash, scope.tenantId);
    return { success: true };
  });

export const clearDecisionsFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireAuthUser();
  const scope = await resolveScope(user.id);
  const repos = getRepositories();
  await repos.decisions.clearUserDecisions(scope.personId, scope.tenantId);
  return { success: true };
});
