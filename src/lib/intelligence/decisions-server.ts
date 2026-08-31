import { createServerFn } from "@tanstack/react-start";
import { getRepositories } from "../../data/sqlite/provider";
import { requireAuthUser } from "../auth/guard";
import { resolveScope } from "./opportunity-service";

export const getDecisionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuthUser();
  const scope = await resolveScope(user.id);
  const repos = getRepositories();
  const map = await repos.decisions.getUserDecisions(scope.personId, scope.tenantId);
  return { success: true, decisions: map };
});

export const saveDecisionFn = createServerFn({ method: "POST" })
  .validator((d: { jobHash: string; verb: string; reason?: string; reviewedFingerprint?: string | null }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = await resolveScope(user.id);
    const repos = getRepositories();
    await repos.decisions.recordUserDecision(scope.personId, data.jobHash, data.verb, data.reason, data.reviewedFingerprint, scope.tenantId);
    return { success: true };
  });

export const syncDecisionsFn = createServerFn({ method: "POST" })
  .validator((d: { decisions: Record<string, { verb: string; reviewedFingerprint?: string | null }> }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const scope = await resolveScope(user.id);
    const repos = getRepositories();
    for (const [jobHash, entry] of Object.entries(data.decisions)) {
      if (entry && entry.verb) {
        await repos.decisions.recordUserDecision(scope.personId, jobHash, entry.verb, undefined, entry.reviewedFingerprint, scope.tenantId);
      }
    }
    const updatedMap = await repos.decisions.getUserDecisions(scope.personId, scope.tenantId);
    return { success: true, decisions: updatedMap };
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
