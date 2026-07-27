import { createServerFn } from "@tanstack/react-start";
import { getRepositories } from "../../data/sqlite/provider";

const DEFAULT_PERSON_ID = "swapnil-shukla";

export const getDecisionsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const repos = getRepositories();
    const map = await repos.decisions.getUserDecisions(DEFAULT_PERSON_ID);
    return { success: true, decisions: map };
  } catch (err: any) {
    console.error("[decisions-server] Error fetching decisions:", err);
    return { success: false, decisions: {} };
  }
});

export const saveDecisionFn = createServerFn({ method: "POST" })
  .validator((d: { jobHash: string; verb: string; reason?: string }) => d)
  .handler(async ({ data }) => {
    try {
      const repos = getRepositories();
      await repos.decisions.recordUserDecision(DEFAULT_PERSON_ID, data.jobHash, data.verb, data.reason);
      return { success: true };
    } catch (err: any) {
      console.error("[decisions-server] Error saving decision:", err);
      return { success: false, error: String(err) };
    }
  });

export const syncDecisionsFn = createServerFn({ method: "POST" })
  .validator((d: { decisions: Record<string, { verb: string }> }) => d)
  .handler(async ({ data }) => {
    try {
      const repos = getRepositories();
      for (const [jobHash, entry] of Object.entries(data.decisions)) {
        if (entry && entry.verb) {
          await repos.decisions.recordUserDecision(DEFAULT_PERSON_ID, jobHash, entry.verb);
        }
      }
      return { success: true };
    } catch (err: any) {
      console.error("[decisions-server] Error syncing decisions:", err);
      return { success: false, error: String(err) };
    }
  });

export const undoDecisionFn = createServerFn({ method: "POST" })
  .validator((d: { jobHash: string }) => d)
  .handler(async ({ data }) => {
    try {
      const repos = getRepositories();
      await repos.decisions.deleteUserDecision(DEFAULT_PERSON_ID, data.jobHash);
      return { success: true };
    } catch (err: any) {
      console.error("[decisions-server] Error deleting decision:", err);
      return { success: false, error: String(err) };
    }
  });

export const clearDecisionsFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const repos = getRepositories();
    await repos.decisions.clearUserDecisions(DEFAULT_PERSON_ID);
    return { success: true };
  } catch (err: any) {
    console.error("[decisions-server] Error clearing decisions:", err);
    return { success: false, error: String(err) };
  }
});
