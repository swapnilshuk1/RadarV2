import { useEffect, useState, useRef } from "react";
import { getRunEventsFn } from "../../lib/intelligence/scrape-server";

interface ScraperConsoleProps {
  runId: string | null;
  onClose: () => void;
  onRefreshFeed: () => void;
  onConfirm: (data: { data: { runId: string } }) => Promise<any>;
  onAbort: (data: { data: { runId: string } }) => Promise<any>;
}

interface RunSummary {
  portalsCompleted: number;
  cardsFound: number;
  extracted: number;
}

export function ScraperConsole({ runId, onClose, onRefreshFeed, onConfirm, onAbort }: ScraperConsoleProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [summary, setSummary] = useState<RunSummary>({ portalsCompleted: 0, cardsFound: 0, extracted: 0 });
  const [status, setStatus] = useState<string>("running");
  const [portalHealth, setPortalHealth] = useState<Record<string, { status: string, details: string }>>({});
  const [completed, setCompleted] = useState(false);
  
  const nextIndexRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  
  // Adaptive polling
  const [pollInterval, setPollInterval] = useState(1000);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isAborting, setIsAborting] = useState(false);
  const runStartRef = useRef(Date.now());

  // Reset state when runId changes
  useEffect(() => {
    if (runId) {
      setIsOpen(true);
      setEvents([]);
      setSummary({ portalsCompleted: 0, cardsFound: 0, extracted: 0 });
      setStatus("running");
      setPortalHealth({});
      setCompleted(false);
      nextIndexRef.current = 0;
      runStartRef.current = Date.now();
      setPollInterval(1000);
    } else {
      setIsOpen(false);
    }
  }, [runId]);

  // Polling loop
  useEffect(() => {
    if (!runId || completed) return;

    let timeoutId: NodeJS.Timeout;

    const poll = async () => {
      try {
        const res: any = await getRunEventsFn({ data: { runId, afterIndex: nextIndexRef.current } });
        
        if (res.events.length > 0) {
          setEvents(prev => [...prev, ...res.events]);
          nextIndexRef.current = res.nextIndex;
        }
        
        setSummary(res.summary);
        setStatus(res.status);
        if (res.portalHealth) setPortalHealth(res.portalHealth);
        
        if (res.completed) {
          setCompleted(true);
          onRefreshFeed();
          // Keep success visible for 5s, then close
          setTimeout(() => {
            onClose();
          }, 5000);
          return; // stop polling
        }
      } catch (err) {
        console.error("Failed to poll scraper status", err);
      }

      // Adjust backoff
      const elapsed = Date.now() - runStartRef.current;
      let nextInterval = 1000;
      if (elapsed > 120_000) nextInterval = 3000;
      else if (elapsed > 30_000) nextInterval = 2000;
      
      setPollInterval(nextInterval);
      timeoutId = setTimeout(poll, nextInterval);
    };

    timeoutId = setTimeout(poll, pollInterval);
    return () => clearTimeout(timeoutId);
  }, [runId, completed, pollInterval, onRefreshFeed, onClose]);

  // Auto-scroll to bottom of events
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, isOpen]);

  if (!runId && !isOpen) return null;

  // Format events for UI
  const formatEvent = (e: any) => {
    switch (e.type) {
      case "run_started": return `🚀 Scan initiated`;
      case "unit_started": return `⚙️ Starting ${e.unitId?.split(":")[0] ?? "portal"}`;
      case "unit_failed": return `⚠️ ${e.unitId?.split(":")[0] ?? "portal"} timed out or failed`;
      case "snapshot_written": return `💾 Snapshot saved`;
      case "extraction_written": return `🧠 Extraction complete`;
      case "run_finished": return `✅ Scan complete (${e.status})`;
      case "signal": return `🛑 Aborted by ${e.signal}`;
      default: return null;
    }
  };

  const uiEvents = events.map(formatEvent).filter(Boolean).slice(-50); // keep last 50 visible

  // Fake portal progress based on total expected (3 portals)
  const portalsTotal = 3;
  const portalPct = Math.round((Math.min(summary.portalsCompleted, portalsTotal) / portalsTotal) * 100);
  
  return (
    <div className={`fixed bottom-6 right-6 z-50 w-80 rounded-md border border-hairline bg-ink text-parchment shadow-2xl transition-transform duration-300 ${isOpen ? "translate-y-0" : "translate-y-[150%]"}`}>
      {/* Header */}
      <div 
        className="flex cursor-pointer items-center justify-between border-b border-white/10 bg-white/5 px-4 py-2"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="text-[11px] font-medium uppercase tracking-[0.14em]">
          {completed ? "✔ Scan Complete" : "Scan Progress"}
        </span>
        <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-white/50 hover:text-white">
          ×
        </button>
      </div>

      {/* Body */}
      {isOpen && (
        <div className="flex flex-col p-4 text-[13px] font-mono leading-relaxed">
          {status === "waiting_for_confirmation" ? (
            <div className="mb-4 flex flex-col gap-3 rounded bg-white/5 p-3">
              <div className="font-semibold text-white">Browser Sessions Ready</div>
              <div className="flex flex-col gap-2">
                {["LinkedIn", "Indeed", "Naukri"].map(p => {
                  const h = portalHealth[p];
                  const isReady = h?.status === "ready";
                  return (
                    <div key={p} className="flex flex-col text-[12px]">
                      <div className="flex items-center gap-2">
                        <span>{isReady ? "✅" : h?.status === "error" ? "❌" : "⚠️"}</span>
                        <span className="font-medium text-white/90">{p}</span>
                      </div>
                      <span className="pl-6 text-white/50">{h?.details || "Waiting..."}</span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-2 flex gap-2">
                <button 
                  onClick={async () => {
                    if (!runId || isConfirming || isAborting) return;
                    setIsConfirming(true);
                    try { await onConfirm({ data: { runId } }); } catch {}
                    setIsConfirming(false);
                  }}
                  disabled={isConfirming || isAborting}
                  className="flex-1 rounded bg-decision-pursue py-1.5 font-medium text-ink transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {isConfirming ? "Continuing..." : "Continue"}
                </button>
                <button 
                  onClick={async () => {
                    if (!runId || isConfirming || isAborting) return;
                    setIsAborting(true);
                    try { await onAbort({ data: { runId } }); } catch {}
                    setIsAborting(false);
                  }}
                  disabled={isConfirming || isAborting}
                  className="rounded bg-white/10 px-3 py-1.5 font-medium text-white transition-colors hover:bg-white/20 disabled:opacity-50"
                >
                  {isAborting ? "Aborting..." : "Abort"}
                </button>
              </div>
            </div>
          ) : (
            <div className="mb-4 flex flex-col gap-2 border-b border-white/10 pb-4">
              <div className="flex justify-between">
                <span>Portals</span>
                <span>{summary.portalsCompleted} / 3</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div className="h-full bg-decision-pursue transition-all" style={{ width: `${portalPct}%` }} />
              </div>
  
              <div className="mt-2 flex justify-between text-white/70">
                <span>Cards Found</span>
                <span>{summary.cardsFound}</span>
              </div>
              <div className="flex justify-between text-white/70">
                <span>Extracted</span>
                <span>{summary.extracted}</span>
              </div>
            </div>
          )}

          <div ref={scrollRef} className="flex h-32 flex-col gap-1 overflow-y-auto text-white/60">
            {uiEvents.length === 0 && <span className="animate-pulse">Waking up scraper...</span>}
            {uiEvents.map((msg, i) => (
              <div key={i} className="animate-in fade-in slide-in-from-bottom-1">{msg}</div>
            ))}
            {!completed && uiEvents.length > 0 && <span className="animate-pulse">...</span>}
          </div>
        </div>
      )}
    </div>
  );
}
