import { createServerFn } from "@tanstack/react-start";
import { getDatabase } from "../../data/sqlite/provider";
import { requireAuthUser } from "../auth/guard";

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

export const COMPLETED_PROGRESS: OnboardingProgress = {
  orientationSeen: true,
  evidenceStatus: 'provided',
  intentStatus: 'set',
  arrivalSeen: true,
};

export const getOnboardingProgressFn = createServerFn({ method: "GET" })
  .handler(async () => {
    const user = await requireAuthUser();
    const db = getDatabase();
    const row = await db.one<{ onboarding_progress: string | null }>(
      'SELECT onboarding_progress FROM people WHERE id = ?',
      [user.id]
    );
    if (row?.onboarding_progress) {
      return JSON.parse(row.onboarding_progress) as OnboardingProgress;
    }
    if (user.onboarded) {
      return COMPLETED_PROGRESS;
    }
    return DEFAULT_PROGRESS;
  });

export const saveOnboardingProgressFn = createServerFn({ method: "POST" })
  .validator((data: { progress: Partial<OnboardingProgress> }) => data)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const db = getDatabase();
    
    const row = await db.one<{ onboarding_progress: string | null }>(
      'SELECT onboarding_progress FROM people WHERE id = ?',
      [user.id]
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
      [JSON.stringify(mergedProgress), user.id]
    );
    
    return { success: true, progress: mergedProgress };
  });
