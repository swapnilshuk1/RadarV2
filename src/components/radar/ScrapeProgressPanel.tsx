import React from "react";
import { useScrapeProgress } from "./ScrapeProgressProvider";

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

  if (!runState || isDismissed) {
    return null;
  }

  const {
    status,
    isActive,
    stage,
    opportunitiesFound,
    evaluatedCount,
    remainingCount,
    sources,
  } = runState;

  const isStopping = status === "stopping";
  const isWaitingConfirmation = status === "waiting_for_confirmation";

  // Stage Stepper Configuration
  const stages = [
    { key: "discover", label: "Discover" },
    { key: "evaluate", label: "Evaluate" },
    { key: "prioritize", label: "Prioritize" },
  ];

  const currentStageIndex =
    stage === "discover"
      ? 0
      : stage === "evaluate"
        ? 1
        : stage === "prioritize" || stage === "complete"
          ? 2
          : 0;

  if (isMinimized) {
    return (
      <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 bg-surface-raised border border-border px-4 py-2.5 rounded-lg shadow-xl backdrop-blur-md text-xs font-mono">
        <span className="relative flex h-2 w-2">
          {isActive && (
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-signal opacity-75"></span>
          )}
          <span
            className={`relative inline-flex rounded-full h-2 w-2 ${
              isStopping
                ? "bg-caution"
                : isActive
                  ? "bg-signal"
                  : "bg-muted"
            }`}
          ></span>
        </span>
        <span className="text-foreground tracking-wider uppercase font-semibold">
          {isStopping
            ? "STOPPING SEARCH…"
            : stage === "complete"
              ? "SEARCH COMPLETE"
              : `SEARCHING · ${evaluatedCount} EVALUATED · ${remainingCount} REMAINING`}
        </span>
        <button
          onClick={minimize}
          className="ml-2 text-muted hover:text-foreground text-sm leading-none font-bold"
          title="Expand RADAR Panel"
        >
          [+]
        </button>
      </div>
    );
  }

  return (
    <>
      {/* Floating RADAR Activity Panel */}
      <div className="fixed bottom-6 right-6 z-40 w-96 bg-surface-raised border border-border rounded-xl shadow-2xl backdrop-blur-md overflow-hidden text-sm">
        {/* Header Bar */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-black/20">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              {isActive && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-signal opacity-75"></span>
              )}
              <span
                className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                  isStopping
                    ? "bg-caution"
                    : isActive
                      ? "bg-signal"
                      : "bg-muted"
                }`}
              ></span>
            </span>
            <span className="font-mono text-xs uppercase tracking-wider text-foreground font-bold">
              RADAR OPPORTUNITY SEARCH
            </span>
          </div>

          <div className="flex items-center gap-2 text-muted">
            <button
              onClick={minimize}
              className="p-1 hover:text-foreground font-mono text-xs transition-colors"
              title="Minimize panel"
            >
              −
            </button>
            <button
              onClick={dismiss}
              className="p-1 hover:text-foreground font-mono text-xs transition-colors"
              title="Dismiss panel"
            >
              ×
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 space-y-4">
          {/* Stage Stepper */}
          <div className="grid grid-cols-3 gap-1.5 border-b border-border pb-3">
            {stages.map((stg, idx) => {
              const isCurrent = idx === currentStageIndex;
              const isPast = idx < currentStageIndex;
              return (
                <div key={stg.key} className="flex flex-col gap-1">
                  <div
                    className={`h-1 rounded-full transition-all duration-300 ${
                      isCurrent
                        ? "bg-primary"
                        : isPast
                          ? "bg-signal"
                          : "bg-border"
                    }`}
                  ></div>
                  <span
                    className={`font-mono text-[0.65rem] uppercase tracking-wider ${
                      isCurrent
                        ? "text-primary font-bold"
                        : isPast
                          ? "text-foreground"
                          : "text-muted"
                    }`}
                  >
                    {stg.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Outcome Counts */}
          <div className="flex items-baseline justify-between">
            <div className="space-y-0.5">
              <div className="font-serif text-lg font-medium text-foreground">
                {evaluatedCount > 0 ? (
                  <>
                    <span>{evaluatedCount} evaluated</span>
                    <span className="text-muted font-sans text-sm ml-2">
                      · {remainingCount} remaining
                    </span>
                  </>
                ) : (
                  <span>{opportunitiesFound} opportunities found</span>
                )}
              </div>
              <p className="text-xs text-muted">
                {isStopping
                  ? "Halting background workers cleanly..."
                  : isWaitingConfirmation
                    ? "Awaiting your confirmation to start live search"
                    : stage === "discover"
                      ? "Searching target sources for candidate matches"
                      : stage === "evaluate"
                        ? "Extracting evidence & evaluating fit score"
                        : "Prioritizing top opportunities in feed"}
              </p>
            </div>
          </div>

          {/* Sources Pills */}
          <div className="space-y-1.5">
            <span className="font-mono text-[0.65rem] uppercase tracking-widest text-muted">
              SOURCES SEARCHED
            </span>
            <div className="flex flex-wrap gap-2">
              {Object.entries(sources).map(([portal, st]) => (
                <div
                  key={portal}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-black/40 border border-border text-xs font-mono"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      st === "searching"
                        ? "bg-signal animate-pulse"
                        : st === "completed"
                          ? "bg-signal"
                          : st === "failed"
                            ? "bg-caution"
                            : "bg-muted"
                    }`}
                  ></span>
                  <span className="text-foreground">{portal}</span>
                </div>
              ))}
            </div>
          </div>

          {/* User Controls */}
          {isWaitingConfirmation ? (
            <button
              onClick={confirmScrape}
              className="w-full py-2 bg-primary hover:bg-primary-hover text-white font-mono text-xs uppercase tracking-wider font-semibold rounded transition-colors"
            >
              APPROVE & START SEARCH
            </button>
          ) : isActive && !isStopping ? (
            <button
              onClick={requestStop}
              className="w-full py-2 border border-caution/50 hover:border-caution text-caution hover:bg-caution/10 font-mono text-xs uppercase tracking-wider font-semibold rounded transition-colors"
            >
              STOP SEARCH
            </button>
          ) : isStopping ? (
            <div className="w-full py-2 text-center border border-border bg-black/30 font-mono text-xs text-caution uppercase tracking-wider rounded">
              STOPPING SEARCH…
            </div>
          ) : (
            <div className="w-full py-2 text-center border border-border bg-black/30 font-mono text-xs text-muted uppercase tracking-wider rounded">
              SEARCH COMPLETE
            </div>
          )}
        </div>
      </div>

      {/* Explicit Stop Confirmation Modal */}
      {isConfirmationOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md bg-surface-raised border border-border p-6 rounded-xl shadow-2xl space-y-4">
            <h3 className="font-serif text-lg font-bold text-foreground">
              Stop Opportunity Search?
            </h3>
            <p className="text-sm text-muted leading-relaxed">
              Are you sure you want to stop the current search run? Any opportunities evaluated so far will remain saved in your RADAR feed.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                onClick={cancelStop}
                className="px-4 py-2 border border-border hover:bg-black/20 text-foreground font-mono text-xs uppercase tracking-wider rounded transition-colors"
              >
                KEEP SEARCHING
              </button>
              <button
                onClick={confirmStop}
                className="px-4 py-2 bg-caution hover:bg-red-700 text-white font-mono text-xs uppercase tracking-wider font-semibold rounded transition-colors"
              >
                CONFIRM STOP
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
