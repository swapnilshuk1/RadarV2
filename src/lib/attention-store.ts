import { useEffect, useState } from "react";
import { getUserPreferencesFn, saveUserPreferencesFn, sanitizeAttentionWindow } from "./intelligence/preferences-server";

const LOCAL_STORAGE_KEY = "radar_attention_window";

export function useAttentionPreference(initialAttentionWindow?: number) {
  const [saveStatus, setSaveStatus] = useState("");
  const [attentionWindow, setAttentionWindowState] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (cached) {
        return sanitizeAttentionWindow(cached);
      }
    }
    return sanitizeAttentionWindow(initialAttentionWindow ?? 6);
  });

  useEffect(() => {
    let active = true;
    getUserPreferencesFn()
      .then((res) => {
        if (active && res.success && res.preferences?.attentionWindow) {
          const val = sanitizeAttentionWindow(res.preferences.attentionWindow);
          setAttentionWindowState(val);
          if (typeof window !== "undefined") {
            localStorage.setItem(LOCAL_STORAGE_KEY, String(val));
          }
        }
      })
      .catch((err) => {
        console.warn("[useAttentionPreference] Server sync fallback:", err);
      });
    return () => {
      active = false;
    };
  }, [initialAttentionWindow]);

  const setAttentionWindow = (val: number) => {
    const sanitized = sanitizeAttentionWindow(val);
    setAttentionWindowState(sanitized);
    if (typeof window !== "undefined") {
      localStorage.setItem(LOCAL_STORAGE_KEY, String(sanitized));
    }
    setSaveStatus("Saving display preference…");
    saveUserPreferencesFn({ data: { attentionWindow: sanitized } }).then(() => setSaveStatus("Display preference saved.")).catch((err) => {
      setSaveStatus("Display preference could not be saved. Please try again.");
      console.warn("[useAttentionPreference] Save error:", err);
    });
  };

  return {
    attentionWindow,
    setAttentionWindow,
    saveStatus,
  };
}
