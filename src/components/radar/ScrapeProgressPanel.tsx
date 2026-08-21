import React, { useState, useEffect, useMemo } from "react";
import { useScrapeProgress } from "./ScrapeProgressProvider";

const INITIAL_SCHEMA_QUERIES = [
  "Chief Marketing Officer",
  "Chief Growth Officer",
  "VP Growth & Digital",
  "Senior Vice President Marketing",
  "Global Marketing Director",
  "Head of MarTech & CRM",
  "Chief Commercial Officer",
  "VP Customer Experience",
  "Center of Excellence Director",
  "Chief Digital Officer",
];

const INITIAL_STAGES = [
  { label: "Building Executive Search Schema", desc: "Synthesizing career intent & target role ontologies" },
  { label: "Arming Multi-Portal Query Matrix", desc: "Compiling 60 high-affinity boolean query permutations" },
  { label: "Hooking Into Secure Stealth Sessions", desc: "Establishing headless browser sessions & cookies" },
  { label: "Initiating Live Market Crawl", desc: "Crawling executive mandates across target platforms" },
];

export function ScrapeProgressPanel() {
  const {
    runState,
    isMinimized,
    isDismissed,
    isConfirmationOpen,
    requestStop,
    confirmStop,
    cancelStop,
    minimize,
    dismiss,
    confirmScrape,
  } = useScrapeProgress();

  // Dynamic animation ticker states for fluid engagement
  const [schemaQueryIndex, setSchemaQueryIndex] = useState(0);
  const [initStageIndex, setInitStageIndex] = useState(0);
  const [pulseCount, setPulseCount] = useState(0);

  // Cycle through compiled queries rapidly during initialization to show continuous activity
  useEffect(() => {
    const queryInterval = setInterval(() => {
      setSchemaQueryIndex((prev) => (prev + 1) % INITIAL_SCHEMA_QUERIES.length);
      setPulseCount((c) => c + 1);
    }, 900);

    const stageInterval = setInterval(() => {
      setInitStageIndex((prev) => (prev < INITIAL_STAGES.length - 1 ? prev + 1 : prev));
    }, 2800);

    return () => {
      clearInterval(queryInterval);
      clearInterval(stageInterval);
    };
  }, []);

  const {
    status,
    isActive,
    opportunitiesFound = 0,
    evaluatedCount = 0,
    remainingCount = 0,
    sources = {},
    portalHealth = {},
    recentActivities = [],
  } = runState || ({} as any);

  const isInitializing = status === "initializing" || (runState && runState.runId === "starting");
  const isStopping = status === "stopping";
  const isWaitingConfirmation = status === "waiting_for_confirmation";
  const isComplete = status === "completed" || (!isActive && !isStopping && !isInitializing);

  // Extract current active action and query
  const currentActivity = useMemo(() => {
    if (recentActivities && recentActivities.length > 0) {
      // Remove timestamp bracket if present
      return recentActivities[0].replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, "");
    }
    if (isStopping) return "Halting browser contexts & safely committing opportunities...";
    if (isInitializing) return INITIAL_STAGES[initStageIndex].label;
    if (isComplete) return "Search run complete. Executive shortlist updated.";
    return `Scanning for "${INITIAL_SCHEMA_QUERIES[schemaQueryIndex]}"...`;
  }, [recentActivities, isStopping, isInitializing, initStageIndex, isComplete, schemaQueryIndex]);

  // Clean recent activities (newest first, max 4 lines)
  const activityHistory = useMemo(() => {
    if (!recentActivities || recentActivities.length === 0) {
      if (isInitializing) {
        return [
          `✓ ${INITIAL_STAGES[Math.max(0, initStageIndex - 1)].label}`,
          `› ${INITIAL_STAGES[initStageIndex].desc}`,
          `› Calibrating query: "${INITIAL_SCHEMA_QUERIES[schemaQueryIndex]}"`,
        ];
      }
      return ["› Awaiting live activity stream..."];
    }
    return recentActivities.slice(0, 4).map((msg: string) => msg.replace(/^\[\d{2}:\d{2}:\d{2}\]\s*/, ""));
  }, [recentActivities, isInitializing, initStageIndex, schemaQueryIndex]);

  // Portal status matrix configuration with personalized status lines
  const portalEntries = useMemo(() => {
    const list = [
      { key: "LinkedIn", name: "LinkedIn", friendlyConnected: "Hooked to profile", friendlyConn: "Hooking session..." },
      { key: "Naukri", name: "Naukri", friendlyConnected: "Gateway ready", friendlyConn: "Connecting gateway..." },
      { key: "Indeed", name: "Indeed", friendlyConnected: "Say hello to Indeed!", friendlyConn: "Saying hello..." },
    ];

    return list.map((item) => {
      const srcState = sources[item.key];
      const health = portalHealth[item.key];
      let state: "connecting" | "authenticated" | "searching" | "completed" | "error" = "connecting";
      let statusLabel = item.friendlyConn;

      if (srcState === "completed") {
        state = "completed";
        statusLabel = "Crawled";
      } else if (srcState === "searching") {
        state = "searching";
        statusLabel = "Active Search";
      } else if (health?.status === "ready" || health?.status === "navigating") {
        state = "authenticated";
        statusLabel = item.friendlyConnected;
      } else if (health?.status === "error" || srcState === "failed") {
        state = "error";
        statusLabel = "Session Gated";
      } else if (isInitializing) {
        state = "connecting";
        statusLabel = item.friendlyConn;
      } else {
        state = "authenticated";
        statusLabel = item.friendlyConnected;
      }

      return {
        key: item.key,
        name: item.name,
        state,
        statusLabel,
      };
    });
  }, [sources, portalHealth, isInitializing]);

  if (!runState || isDismissed) {
    return null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MINIMIZED FLOATING RADAR PILL DOCK
  // ──────────────────────────────────────────────────────────────────────────
  if (isMinimized) {
    return (
      <div 
        onClick={minimize}
        className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-surface-raised/95 border border-border px-4 py-2.5 rounded-full shadow-2xl backdrop-blur-xl text-xs font-mono cursor-pointer hover:border-primary/50 transition-all group"
        title="Click to expand RADAR Intelligence HUD"
      >
        <span className="relative flex h-2.5 w-2.5">
          {isActive && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
          )}
          <span
            className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
              isStopping
                ? "bg-amber-500 animate-pulse"
                : isActive
                  ? "bg-emerald-500"
                  : "bg-muted-foreground"
            }`}
          />
        </span>
        <span className="text-foreground tracking-wider uppercase font-semibold text-[11px]">
          {isStopping
            ? "STOPPING SEARCH…"
            : isComplete
              ? "SEARCH COMPLETE"
              : isInitializing
                ? `INITIALIZING · ${INITIAL_SCHEMA_QUERIES[schemaQueryIndex]}`
                : `RADAR ACTIVE · ${opportunitiesFound} FOUND · ${evaluatedCount} EVALUATED`}
        </span>
        <span className="text-muted-foreground group-hover:text-foreground text-xs leading-none font-bold pl-1">
          [+]
        </span>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // EXPANDED EXECUTIVE RADAR HUD
  // ──────────────────────────────────────────────────────────────────────────
  return (
    <>
      <aside 
        aria-label="RADAR Intelligence Engine Active Scan"
        className="fixed bottom-6 right-6 z-50 w-[390px] max-w-[calc(100vw-32px)] bg-surface-raised/95 border border-border rounded-xl shadow-2xl backdrop-blur-2xl overflow-hidden text-sm animate-reveal select-none transition-all duration-300"
      >
        {/* Top Scanning Radar Sweep Line */}
        <div className="relative h-[2px] w-full bg-border/60 overflow-hidden">
          {isActive && !isStopping && (
            <div className="absolute top-0 bottom-0 w-36 bg-gradient-to-r from-transparent via-emerald-500 to-transparent animate-scan-line" />
          )}
          {isStopping && (
            <div className="absolute inset-0 bg-amber-500/80 animate-pulse" />
          )}
        </div>

        {/* HUD Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface/50">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2 w-2">
              {isActive && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
              )}
              <span
                className={`relative inline-flex rounded-full h-2 w-2 ${
                  isStopping
                    ? "bg-amber-500"
                    : isActive
                      ? "bg-emerald-500"
                      : "bg-muted-foreground"
                }`}
              />
            </span>
            <span className="label-mono font-bold tracking-widest text-foreground text-[10px]">
              {isStopping ? "HALTING SEARCH ENGINE" : "RADAR INTELLIGENCE HUD"}
            </span>
          </div>

          <div className="flex items-center gap-1 text-muted-foreground">
            <button
              type="button"
              onClick={minimize}
              className="p-1.5 hover:text-foreground font-mono text-xs transition-colors rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              title="Minimize panel"
              aria-label="Minimize"
            >
              −
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="p-1.5 hover:text-foreground font-mono text-xs transition-colors rounded hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer"
              title="Dismiss panel"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
        </div>

        {/* HUD Body */}
        <div className="p-4 space-y-3.5">
          {/* Target Portal Connections Matrix */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="label-mono text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">
                TARGET PORTAL CHANNELS
              </span>
              <span className="label-mono text-[9px] text-muted-foreground flex items-center gap-1">
                {isInitializing ? (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                    AUTHENTICATING
                  </>
                ) : isStopping ? (
                  "CLOSING"
                ) : (
                  <>
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    CHANNELS ARMED
                  </>
                )}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              {portalEntries.map((portal) => {
                const isConn = portal.state === "connecting";
                const isReady = portal.state === "authenticated" || portal.state === "searching" || portal.state === "completed";
                const isErr = portal.state === "error";

                return (
                  <div
                    key={portal.key}
                    className={`flex flex-col gap-1 p-2 rounded-lg border transition-all duration-300 ${
                      isConn
                        ? "border-amber-500/30 bg-amber-500/5 shadow-xs"
                        : isReady
                          ? "border-emerald-500/25 bg-emerald-500/5"
                          : isErr
                            ? "border-red-500/20 bg-red-500/5"
                            : "border-border bg-surface"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-[11px] font-bold text-foreground truncate">
                        {portal.name}
                      </span>
                      <span className="relative flex h-2 w-2 shrink-0">
                        {isConn && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                        )}
                        {isReady && portal.state === "searching" && (
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        )}
                        <span
                          className={`relative inline-flex rounded-full h-2 w-2 ${
                            isConn
                              ? "bg-amber-400"
                              : isReady
                                ? "bg-emerald-500"
                                : isErr
                                  ? "bg-red-500"
                                  : "bg-muted-foreground"
                          }`}
                        />
                      </span>
                    </div>
                    <span className={`font-mono text-[9px] truncate transition-colors duration-200 ${
                      isReady ? "text-emerald-700 dark:text-emerald-400 font-medium" : isConn ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"
                    }`}>
                      {portal.statusLabel}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Rapid-Fire Schema & Search Radar Visualizer (Shown especially during initialization & searching) */}
          <div className="p-2.5 rounded-lg border border-primary/20 bg-surface/80 space-y-1.5 transition-all">
            <div className="flex items-center justify-between">
              <span className="label-mono text-[9px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                </span>
                {isInitializing ? "BUILDING SEARCH SCHEMA" : "ACTIVE SEARCH RADAR"}
              </span>
              <span className="label-mono text-[8px] text-muted-foreground tabular-nums">
                MANDATE #{schemaQueryIndex + 1} OF 60
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 overflow-hidden">
              <div className="font-mono text-[11px] font-semibold text-foreground truncate flex items-center gap-1.5">
                <span className="text-primary font-bold">›</span>
                <span className="animate-reveal inline-block key={schemaQueryIndex}">
                  "{INITIAL_SCHEMA_QUERIES[schemaQueryIndex]}"
                </span>
              </div>
              <span className="label-mono shrink-0 px-2 py-0.5 rounded text-[8px] bg-primary/10 text-primary font-bold uppercase tracking-wider">
                {isInitializing ? "COMPILED" : "SCANNING"}
              </span>
            </div>
          </div>

          {/* Quantitative Counters Grid */}
          <div className="grid grid-cols-3 gap-2 p-2.5 rounded-lg border border-border bg-surface/60 text-center">
            <div>
              <span className="label-mono block text-[8px] uppercase tracking-wider text-muted-foreground">
                DISCOVERED
              </span>
              <span className="font-mono text-base font-bold text-foreground tabular-nums">
                {opportunitiesFound}
              </span>
            </div>
            <div className="border-x border-border/80">
              <span className="label-mono block text-[8px] uppercase tracking-wider text-muted-foreground">
                EVALUATED
              </span>
              <span className="font-mono text-base font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                {evaluatedCount}
              </span>
            </div>
            <div>
              <span className="label-mono block text-[8px] uppercase tracking-wider text-muted-foreground">
                IN QUEUE
              </span>
              <span className="font-mono text-base font-bold text-muted-foreground tabular-nums">
                {remainingCount}
              </span>
            </div>
          </div>

          {/* Real-time Streaming Telemetry Log */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="label-mono text-[9px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                LIVE ACTIVITY STREAM
              </span>
              <span className="label-mono text-[8px] text-muted-foreground">
                REAL-TIME TELEMETRY
              </span>
            </div>

            <div className="p-2.5 rounded-lg border border-border bg-black/5 dark:bg-black/30 font-mono text-[11px] space-y-1.5 min-h-[84px] max-h-[100px] flex flex-col justify-end overflow-hidden">
              {activityHistory.map((act: string, idx: number) => (
                <div
                  key={idx}
                  className={`flex items-start gap-2 leading-tight transition-all duration-300 ${
                    idx === 0
                      ? "text-foreground font-semibold"
                      : idx === 1
                        ? "text-foreground/75 text-[10.5px]"
                        : "text-muted-foreground/60 text-[10px]"
                  }`}
                >
                  <span className={`shrink-0 ${idx === 0 ? "text-emerald-500 font-bold" : "text-muted-foreground/50"}`}>
                    {idx === 0 ? "●" : "›"}
                  </span>
                  <span className="truncate">{act}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Animated Stopping Indicator Banner */}
          {isStopping && (
            <div className="p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 space-y-2 animate-reveal">
              <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-mono text-xs font-semibold">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                </span>
                <span>Stopping search run…</span>
              </div>
              <p className="font-sans text-[11px] text-muted-foreground leading-relaxed">
                Closing active browser workers and committing all acquired opportunities safely into your dossier database. This takes 1–2 seconds.
              </p>
              <div className="h-1 w-full bg-amber-500/20 rounded-full overflow-hidden">
                <div className="h-full bg-amber-500 w-2/3 animate-scan-line rounded-full" />
              </div>
            </div>
          )}

          {/* Action Button Footer */}
          <div className="pt-0.5">
            {isWaitingConfirmation ? (
              <button
                type="button"
                onClick={confirmScrape}
                className="w-full py-2.5 bg-primary hover:opacity-90 text-primary-foreground font-mono text-[11px] uppercase tracking-wider font-bold rounded-lg transition-all shadow-sm cursor-pointer"
              >
                APPROVE & START SEARCH
              </button>
            ) : isActive && !isStopping ? (
              <button
                type="button"
                onClick={requestStop}
                className="w-full py-2.5 border border-amber-500/40 hover:border-amber-500 hover:bg-amber-500/10 text-amber-700 dark:text-amber-400 font-mono text-[11px] uppercase tracking-wider font-bold rounded-lg transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                <span className="h-2 w-2 rounded-xs bg-amber-500" />
                STOP SEARCH
              </button>
            ) : isStopping ? (
              <div className="w-full py-2 text-center border border-border bg-surface font-mono text-[11px] text-amber-600 dark:text-amber-400 uppercase tracking-wider font-semibold rounded-lg">
                FINISHING SHUTDOWN…
              </div>
            ) : (
              <button
                type="button"
                onClick={dismiss}
                className="w-full py-2.5 border border-border hover:bg-surface text-foreground font-mono text-[11px] uppercase tracking-wider font-semibold rounded-lg transition-all cursor-pointer"
              >
                DISMISS HUD
              </button>
            )}
          </div>
        </div>
      </aside>

      {/* Explicit Stop Confirmation Modal */}
      {isConfirmationOpen && (
        <div 
          role="dialog"
          aria-modal="true"
          aria-labelledby="stop-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-reveal"
        >
          <div className="w-full max-w-md bg-surface-raised border border-border p-6 rounded-xl shadow-2xl space-y-4">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20 font-mono font-bold text-sm">
                !
              </span>
              <div>
                <h3 id="stop-dialog-title" className="font-serif text-xl font-medium text-foreground">
                  Stop Search Execution?
                </h3>
                <p className="text-xs font-mono text-muted-foreground">
                  INSTANT SHUTDOWN & PERSISTENCE
                </p>
              </div>
            </div>
            
            <p className="text-sm text-muted-foreground leading-relaxed">
              Are you sure you want to halt the live search pipeline? Active browser workers will terminate immediately, and all opportunities discovered so far will remain saved in your feed.
            </p>

            <div className="flex items-center justify-end gap-3 pt-3">
              <button
                type="button"
                onClick={cancelStop}
                className="px-4 py-2 border border-border hover:bg-surface text-foreground font-mono text-xs uppercase tracking-wider font-semibold rounded-lg transition-all cursor-pointer"
              >
                KEEP SEARCHING
              </button>
              <button
                type="button"
                onClick={confirmStop}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-mono text-xs uppercase tracking-wider font-bold rounded-lg transition-all shadow-sm cursor-pointer"
              >
                HALT IMMEDIATELY
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
