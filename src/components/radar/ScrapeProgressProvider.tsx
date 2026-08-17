import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { useRouter } from "@tanstack/react-router";
import {
  triggerScrapeFn,
  getActiveScrapeFn,
  getRunProgressFn,
  abortScrapeFn,
  confirmScrapeFn,
} from "../../lib/intelligence/scrape-server";

export type ScrapeStage = "discover" | "evaluate" | "prioritize" | "complete" | "stopped" | "failed";

export interface CanonicalScrapeState {
  runId: string;
  status: string;
  isActive: boolean;
  stage: ScrapeStage;
  opportunitiesFound: number;
  evaluatedCount: number;
  remainingCount: number;
  sources: Record<string, "pending" | "searching" | "completed" | "failed">;
  portalHealth?: Record<string, any>;
  recentActivities?: string[];
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
}

interface ScrapeProgressContextType {
  // Persistent Server Run State
  runState: CanonicalScrapeState | null;
  
  // Transient UI State
  isMinimized: boolean;
  isDismissed: boolean;
  isConfirmationOpen: boolean;
  isStarting: boolean;

  // Actions
  startScrape: () => Promise<void>;
  requestStop: () => void;
  confirmStop: () => Promise<void>;
  cancelStop: () => void;
  minimize: () => void;
  dismiss: () => void;
  restore: () => void;
  confirmScrape: () => Promise<void>;
}

const ScrapeProgressContext = createContext<ScrapeProgressContextType | null>(null);

export function ScrapeProgressProvider({ children }: { children: React.ReactNode }) {
  const [runState, setRunState] = useState<CanonicalScrapeState | null>(null);
  
  // Transient UI State
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [isConfirmationOpen, setIsConfirmationOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const router = useRouter();

  // Helper to sync canonical state from server response
  const syncServerState = useCallback((data: any) => {
    if (!data) {
      setRunState(null);
      return;
    }
    setRunState({
      runId: data.runId,
      status: data.status,
      isActive: data.isActive,
      stage: data.stage || "discover",
      opportunitiesFound: data.opportunitiesFound || 0,
      evaluatedCount: data.evaluatedCount || 0,
      remainingCount: data.remainingCount || 0,
      sources: data.sources || { LinkedIn: "pending", Naukri: "pending", Indeed: "pending" },
      portalHealth: data.portalHealth || {},
      startedAt: data.startedAt,
      updatedAt: data.updatedAt,
      finishedAt: data.finishedAt,
    });
  }, []);

  // 1. Initial Hydration on Boot / Refresh
  useEffect(() => {
    let mounted = true;
    async function hydrate() {
      try {
        const active = await getActiveScrapeFn();
        if (mounted && active) {
          syncServerState(active);
          // Active server state wins over transient dismissal on page load!
          setIsDismissed(false);
        }
      } catch (err) {
        console.error("[ScrapeProgressProvider] Boot hydration failed:", err);
      }
    }
    void hydrate();
    return () => { mounted = false; };
  }, [syncServerState]);

  // 2. Reconciliation Polling Loop while Run is Active
  useEffect(() => {
    if (!runState?.runId || !runState.isActive || runState.runId === "starting") return;

    const interval = setInterval(async () => {
      try {
        const updated = await getRunProgressFn({ data: { runId: runState.runId } });
        if (updated) {
          syncServerState(updated);
          if (!updated.isActive && runState.isActive) {
            // Run just completed/stopped/failed — refresh feed
            router.invalidate();
          }
        }
      } catch (err) {
        console.error("[ScrapeProgressProvider] Reconciliation poll error:", err);
      }
    }, 1500); // 1.5-second live reconciliation loop

    return () => clearInterval(interval);
  }, [runState?.runId, runState?.isActive, syncServerState, router]);

  // Actions
  const startScrape = useCallback(async () => {
    if (runState?.isActive || isStarting) return;
    setIsStarting(true);
    setIsDismissed(false);
    setIsMinimized(false);

    // 1. Instant optimistic state so widget appears IMMEDIATELY on click
    setRunState({
      runId: "starting",
      status: "initializing",
      isActive: true,
      stage: "discover",
      opportunitiesFound: 0,
      evaluatedCount: 0,
      remainingCount: 0,
      sources: { LinkedIn: "searching", Naukri: "pending", Indeed: "pending" },
      portalHealth: {},
      startedAt: new Date().toISOString(),
    });

    try {
      const res = await triggerScrapeFn();
      if (res.success && res.runId) {
        setIsDismissed(false);
        setIsMinimized(false);
        // Hydrate initial progress immediately
        const fresh = await getRunProgressFn({ data: { runId: res.runId } });
        if (fresh) {
          syncServerState(fresh);
        } else {
          setRunState(prev => prev ? { ...prev, runId: res.runId, status: "running" } : null);
        }
      } else {
        setRunState(null);
        alert("Failed to start search: " + (res.error || "Unknown error"));
      }
    } catch (err: any) {
      console.error("[ScrapeProgressProvider] triggerScrapeFn failed:", err);
      setRunState(null);
      alert("Error starting search: " + err.message);
    } finally {
      setIsStarting(false);
    }
  }, [runState?.isActive, isStarting, syncServerState]);

  const requestStop = useCallback(() => {
    setIsConfirmationOpen(true);
  }, []);

  const cancelStop = useCallback(() => {
    setIsConfirmationOpen(false);
  }, []);

  const confirmStop = useCallback(async () => {
    setIsConfirmationOpen(false);
    if (!runState?.runId) return;

    const targetRunId = runState.runId;
    // Optimistically transition state to stopping
    setRunState((prev) => prev ? { ...prev, status: "stopping" } : null);

    try {
      if (targetRunId !== "starting") {
        await abortScrapeFn({ data: { runId: targetRunId } });
        const updated = await getRunProgressFn({ data: { runId: targetRunId } });
        if (updated) syncServerState(updated);
      } else {
        setRunState(null);
      }
    } catch (err) {
      console.error("[ScrapeProgressProvider] confirmStop failed:", err);
    }
  }, [runState?.runId, syncServerState]);

  const confirmScrape = useCallback(async () => {
    if (!runState?.runId) return;
    try {
      await confirmScrapeFn({ data: { runId: runState.runId } });
      const updated = await getRunProgressFn({ data: { runId: runState.runId } });
      if (updated) syncServerState(updated);
    } catch (err) {
      console.error("[ScrapeProgressProvider] confirmScrape failed:", err);
    }
  }, [runState?.runId, syncServerState]);

  const minimize = useCallback(() => setIsMinimized((prev) => !prev), []);
  const dismiss = useCallback(() => setIsDismissed(true), []);
  const restore = useCallback(() => {
    setIsDismissed(false);
    setIsMinimized(false);
  }, []);

  return (
    <ScrapeProgressContext.Provider
      value={{
        runState,
        isMinimized,
        isDismissed,
        isConfirmationOpen,
        isStarting,
        startScrape,
        requestStop,
        confirmStop,
        cancelStop,
        minimize,
        dismiss,
        restore,
        confirmScrape,
      }}
    >
      {children}
    </ScrapeProgressContext.Provider>
  );
}

export function useScrapeProgress() {
  const ctx = useContext(ScrapeProgressContext);
  if (!ctx) {
    throw new Error("useScrapeProgress must be used within a ScrapeProgressProvider");
  }
  return ctx;
}
