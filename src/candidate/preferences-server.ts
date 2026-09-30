import { createServerFn } from "@tanstack/react-start";
import { getDatabaseAdapter } from "@/data/database";
import { requireAuthUser } from "@/lib/auth/guard";

export function sanitizeAttentionWindow(val: unknown): number {
  const num = typeof val === "number" ? val : parseInt(String(val), 10);
  if (isNaN(num) || num < 1 || num > 10) {
    return 6;
  }
  return num;
}

export const getUserPreferencesFn = createServerFn({ method: "GET" }).handler(async () => {
  const user = await requireAuthUser();
  const row = await getDatabaseAdapter().one<{attention_window:number}>("SELECT attention_window FROM user_preferences WHERE user_id = ?", [user.id]);
  const attentionWindow = sanitizeAttentionWindow(row?.attention_window);
  return { success: true, preferences: { attentionWindow } };
});

export const saveUserPreferencesFn = createServerFn({ method: "POST" })
  .validator((p: { attentionWindow?: number }) => p)
  .handler(async ({ data }) => {
    const user = await requireAuthUser();
    const sanitizedWindow = sanitizeAttentionWindow(data.attentionWindow);
    await getDatabaseAdapter().execute("INSERT INTO user_preferences(user_id, attention_window, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(user_id) DO UPDATE SET attention_window=excluded.attention_window, updated_at=CURRENT_TIMESTAMP", [user.id, sanitizedWindow]);
    return { success: true, attentionWindow: sanitizedWindow };
  });
