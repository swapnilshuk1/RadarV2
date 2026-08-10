import { createServerFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { getDatabase } from "../../data/sqlite/provider";
import { validateSessionToken, SESSION_COOKIE_NAME } from "../auth/session";

export interface OnboardingProgress {
  orientationSeen: boolean;
  evidenceStatus: 'pending' | 'provided' | 'skipped';
  intentStatus: 'pending' | 'set' | 'skipped';
  arrivalSeen: boolean;
}

export const DEFAULT_PROGRESS: OnboardingProgress = {
  orientationSeen: false,
  evidenceStatus: 'pending',
  intentStatus: 'pending',
  arrivalSeen: false,
};

async function getAuthenticatedUserId(): Promise<string> {
  try {
    const token = getCookie(SESSION_COOKIE_NAME);
    if (token) {
      const { user } = await validateSessionToken(token);
      if (user?.id) return user.id;
    }
  } catch (err) {
    console.warn("[onboarding-server] Session lookup fallback triggered:", err);
  }
  return "swapnil-shukla"; // Same fallback as document-server
}

export const getOnboardingProgressFn = createServerFn({ method: "GET" })
  .handler(async () => {
    try {
      const userId = await getAuthenticatedUserId();
      const db = getDatabase();
      const row = await db.one<{ onboarding_progress: string | null }>(
        'SELECT onboarding_progress FROM people WHERE id = ?',
        [userId]
      );
      if (row?.onboarding_progress) {
        return JSON.parse(row.onboarding_progress) as OnboardingProgress;
      }
      return DEFAULT_PROGRESS;
    } catch (err) {
      console.error("[onboarding-server] Error fetching onboarding progress:", err);
      return DEFAULT_PROGRESS;
    }
  });

export const saveOnboardingProgressFn = createServerFn({ method: "POST" })
  .validator((data: { progress: Partial<OnboardingProgress> }) => data)
  .handler(async ({ data }) => {
    try {
      const userId = await getAuthenticatedUserId();
      const db = getDatabase();
      
      const row = await db.one<{ onboarding_progress: string | null }>(
        'SELECT onboarding_progress FROM people WHERE id = ?',
        [userId]
      );
      
      let current = { ...DEFAULT_PROGRESS };
      if (row?.onboarding_progress) {
        try {
          current = { ...current, ...JSON.parse(row.onboarding_progress) };
        } catch (e) {
          // ignore parse error, use default
        }
      }
      
      const mergedProgress = { ...current, ...data.progress };
      
      await db.execute(
        'UPDATE people SET onboarding_progress = ? WHERE id = ?',
        [JSON.stringify(mergedProgress), userId]
      );
      
      return { success: true, progress: mergedProgress };
    } catch (err: any) {
      console.error("[onboarding-server] Error saving onboarding progress:", err);
      return { success: false, error: String(err), progress: DEFAULT_PROGRESS };
    }
  });
