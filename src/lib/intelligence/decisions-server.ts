import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { getRepositories } from "../../data/sqlite/provider";
import { validateSessionToken, SESSION_COOKIE_NAME } from "../auth/session";

async function getAuthenticatedUserId(): Promise<string> {
  try {
    const token = getCookie(SESSION_COOKIE_NAME);
    if (token) {
      const { user } = await validateSessionToken(token);
      if (user?.id) return user.id;
    }
  } catch (err) {
    console.warn("[decisions-server] Session lookup fallback triggered:", err);
  }
  return "swapnil-shukla";
}

export const getDecisionsFn = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const userId = await getAuthenticatedUserId();
    const repos = getRepositories();
    const map = await repos.decisions.getUserDecisions(userId);
    return { success: true, decisions: map };
  } catch (err: any) {
    console.error("[decisions-server] Error fetching decisions:", err);
    return { success: false, decisions: {} };
  }
});

export const saveDecisionFn = createServerFn({ method: "POST" })
  .validator((d: { jobHash: string; verb: string; reason?: string; reviewedFingerprint?: string | null }) => d)
  .handler(async ({ data }) => {
    try {
      const userId = await getAuthenticatedUserId();
      const repos = getRepositories();
      await repos.decisions.recordUserDecision(userId, data.jobHash, data.verb, data.reason, data.reviewedFingerprint);
      return { success: true };
    } catch (err: any) {
      console.error("[decisions-server] Error saving decision:", err);
      return { success: false, error: String(err) };
    }
  });

export const syncDecisionsFn = createServerFn({ method: "POST" })
  .validator((d: { decisions: Record<string, { verb: string; reviewedFingerprint?: string | null }> }) => d)
  .handler(async ({ data }) => {
    try {
      const userId = await getAuthenticatedUserId();
      const repos = getRepositories();
      for (const [jobHash, entry] of Object.entries(data.decisions)) {
        if (entry && entry.verb) {
          await repos.decisions.recordUserDecision(userId, jobHash, entry.verb, undefined, entry.reviewedFingerprint);
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
      const userId = await getAuthenticatedUserId();
      const repos = getRepositories();
      await repos.decisions.deleteUserDecision(userId, data.jobHash);
      return { success: true };
    } catch (err: any) {
      console.error("[decisions-server] Error deleting decision:", err);
      return { success: false, error: String(err) };
    }
  });

export const clearDecisionsFn = createServerFn({ method: "POST" }).handler(async () => {
  try {
    const userId = await getAuthenticatedUserId();
    const repos = getRepositories();
    await repos.decisions.clearUserDecisions(userId);
    return { success: true };
  } catch (err: any) {
    console.error("[decisions-server] Error clearing decisions:", err);
    return { success: false, error: String(err) };
  }
});
