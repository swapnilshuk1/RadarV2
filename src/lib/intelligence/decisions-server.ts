import { createServerFn } from "@tanstack/react-start";
import { getRepositories } from "../../data/sqlite/provider";
import { requireAuthUser } from "../auth/guard";

export const getDecisionsFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuthUser();
  const repos = getRepositories();
  const map = await repos.decisions.getUserDecisions(user.id);
  return { success: true, decisions: map };
});

export const saveDecisionFn = createServerFn({ method: "POST" })
  .validator((d: { jobHash: string; verb: string; reason?: string; reviewedFingerprint?: string | null }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const repos = getRepositories();
    await repos.decisions.recordUserDecision(user.id, data.jobHash, data.verb, data.reason, data.reviewedFingerprint);
    return { success: true };
  });

export const syncDecisionsFn = createServerFn({ method: "POST" })
  .validator((d: { decisions: Record<string, { verb: string; reviewedFingerprint?: string | null }> }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const repos = getRepositories();
    for (const [jobHash, entry] of Object.entries(data.decisions)) {
      if (entry && entry.verb) {
        await repos.decisions.recordUserDecision(user.id, jobHash, entry.verb, undefined, entry.reviewedFingerprint);
      }
    }
    return { success: true };
  });

export const undoDecisionFn = createServerFn({ method: "POST" })
  .validator((d: { jobHash: string }) => d)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const repos = getRepositories();
    await repos.decisions.deleteUserDecision(user.id, data.jobHash);
    return { success: true };
  });

export const clearDecisionsFn = createServerFn({ method: "POST" }).handler(async () => {
  const user = await requireAuthUser();
  const repos = getRepositories();
  await repos.decisions.clearUserDecisions(user.id);
  return { success: true };
});
