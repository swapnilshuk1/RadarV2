import { createServerFn } from "@tanstack/react-start";
import { getRepositories } from "../../data/sqlite/provider";
import { requireAuthUser } from "../auth/guard";

export function sanitizeAttentionWindow(val: unknown): number {
  const num = typeof val === "number" ? val : parseInt(String(val), 10);
  if (isNaN(num) || num < 1 || num > 10) {
    return 6;
  }
  return num;
}

export const getUserPreferencesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuthUser();
  const repos = getRepositories();
  const state = (await repos.people.getCandidateState(user.id)) || {};
  const attentionWindow = sanitizeAttentionWindow(state.attentionWindow);
  return { success: true, preferences: { attentionWindow } };
});

export const saveUserPreferencesFn = createServerFn({ method: "POST" })
  .validator((p: { attentionWindow?: number }) => p)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const repos = getRepositories();
    const currentState = (await repos.people.getCandidateState(user.id)) || {};
    const sanitizedWindow = sanitizeAttentionWindow(data.attentionWindow);
    
    const updatedState = {
      ...currentState,
      attentionWindow: sanitizedWindow,
    };

    await repos.people.saveCandidateState(user.id, updatedState);
    return { success: true, attentionWindow: sanitizedWindow };
  });
