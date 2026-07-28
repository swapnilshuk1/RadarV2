import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { type Opportunity, type DecisionVerb } from "../data/opportunity-fixtures";
import { candidateSignature } from "../lib/personalization";
import { DecisionBadge } from "../components/radar/DecisionBadge";
import { InlineBrief } from "../components/radar/InlineBrief";
import { SwipeableRow } from "../components/radar/SwipeableRow";
import { useDecisions } from "../lib/decisions-store";
import { OpportunityProvider } from "../lib/intelligence/opportunity-provider";
import { getScrapedJobs, getScraperCounts } from "../data/scraped-jobs";
import { triggerScrapeFn, getLiveScrapedFn, confirmScrapeFn, abortScrapeFn } from "../lib/intelligence/scrape-server";
import { ScraperConsole } from "../components/radar/ScraperConsole";

const VISIBLE_LIMIT = 6;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Shortlist — RADAR" },
      { name: "description", content: "The current shortlist of opportunities RADAR believes deserve serious pursuit." },
      { property: "og:title", content: "Shortlist — RADAR" },
      { property: "og:description", content: "Evidence-anchored career opportunity intelligence for experienced executives." },
    ],
  }),
  component: Shortlist,
});

function Shortlist() {
  const [sessionName, setSessionName] = useState("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const sessionStr = sessionStorage.getItem("radar_session");
      if (sessionStr) {
        try {
          const session = JSON.parse(sessionStr);
          setSessionName(session.name);
        } catch {}
      }
    }
  }, []);

  const signature = sessionName || candidateSignature();

  const { decisions, decide: recordDecision } = useDecisions();
  const [open, setOpen] = useState<string | null>(null);

  // Live run state
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const [lastScanAt, setLastScanAt] = useState<string | null>(null);
  const [extraScraped, setExtraScraped] = useState(0);
  const [opportunitiesVersion, setOpportunitiesVersion] = useState(0);

  useEffect(() => {
    const onChange = () => setOpportunitiesVersion((v) => v + 1);
    window.addEventListener("radar:opportunities", onChange);
    return () => window.removeEventListener("radar:opportunities", onChange);
  }, []);

  const baseCounts = getScraperCounts();

  const activeCount = useMemo(() => {
    return Object.values(decisions).filter((d) => d.verb === "PURSUE").length;
  }, [decisions]);

  const opportunitiesList = useMemo(() => {
    return OpportunityProvider.list({ activePursuits: activeCount });
  }, [activeCount, opportunitiesVersion]);

  const remaining = useMemo(
    () => opportunitiesList.filter((o) => !decisions[o.jobHash]),
    [opportunitiesList, decisions],
  );
  const visible = remaining.slice(0, VISIBLE_LIMIT);
  const queued = Math.max(0, remaining.length - visible.length);

  const decidedList = Object.values(decisions);
  const pursue = decidedList.filter((d) => d.verb === "PURSUE").length;
  const consider = decidedList.filter((d) => d.verb === "CONSIDER").length;
  const pass = decidedList.filter((d) => d.verb === "PASS").length;

  const decide = (jobHash: string, verb: DecisionVerb) => {
    recordDecision(jobHash, verb);
    setOpen((cur) => (cur === jobHash ? null : cur));
  };

  const [isStarting, setIsStarting] = useState(false);

  const runSearch = async () => {
    if (activeRunId || isStarting) return;
    setIsStarting(true);
    try {
      console.log("[Client] Triggering live scrape server function...");
      const result = await triggerScrapeFn();
      if (result.success && result.runId) {
        setActiveRunId(result.runId);
      } else {
        console.error("Scraping execution failed:", result.error);
        alert(`Scraping failed: ${result.error}`);
      }
    } catch (err: any) {
      console.error("Error invoking scrape server function:", err);
      alert(`Error invoking scrape: ${err.message}`);
    } finally {
      setIsStarting(false);
    }
  };

  const handleRefreshFeed = async () => {
    try {
      const freshRecords = await getLiveScrapedFn();
      if (freshRecords && freshRecords.length > 0) {
        OpportunityProvider.injectFresh(freshRecords);
      }
    } catch (err) {
      console.error("Failed to fetch fresh records, falling back:", err);
    }
    setLastScanAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    setExtraScraped((prev) => prev + 1);
  };

  const totalScraped = baseCounts.total + extraScraped;

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ────────────────────────────────────────────────────────────────────────
          LIVE PIPELINE METADATA STRIP
          ──────────────────────────────────────────────────────────────────────── */}
      <div className="border-b border-border/80 bg-muted/20">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-3 sm:px-8 py-2.5 font-mono text-[10px] sm:text-[11px]">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-muted-foreground">
            <span>
              <span className="font-bold text-foreground tabular-nums">{totalScraped}</span> SCRAPED
            </span>
            <span>· LINKEDIN <span className="tabular-nums text-foreground font-semibold">{baseCounts.bySource.LinkedIn}</span></span>
            <span>· NAUKRI <span className="tabular-nums text-foreground font-semibold">{baseCounts.bySource.Naukri}</span></span>
            <span>· INDEED <span className="tabular-nums text-foreground font-semibold">{baseCounts.bySource.Indeed}</span></span>
            <span>→ <span className="tabular-nums text-pursue font-bold">{remaining.length}</span> ON SHORTLIST</span>
            {lastScanAt && !activeRunId && (
              <span className="text-muted-foreground/80">· LAST SCAN {lastScanAt}</span>
            )}
          </div>
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={async () => {
                if (activeRunId || isStarting) {
                  if (activeRunId) await abortScrapeFn({ data: { runId: activeRunId } });
                } else {
                  await runSearch();
                }
              }}
              className="mono text-[10px] tracking-[0.2em] font-bold inline-flex items-center gap-2 rounded-sm border border-foreground bg-foreground px-3 py-1 text-background uppercase transition-opacity hover:opacity-90"
            >
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full bg-background ${
                  activeRunId || isStarting ? "animate-pulse bg-red-500" : ""
                }`}
              />
              {activeRunId || isStarting ? "STOP" : "SEARCH"}
            </button>
            <Link to="/scraped" className="mono text-[10px] tracking-[0.18em] text-foreground hover:underline font-semibold uppercase">
              FEED →
            </Link>
          </div>
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          HERO & PIPELINE LEDGER
          ──────────────────────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-[1180px] px-4 sm:px-8 pt-10 sm:pt-14 pb-8 border-b border-border">
        <p className="mono text-[10px] tracking-[0.24em] text-muted-foreground mb-3 uppercase font-semibold">
          PIPELINE LEDGER & EXECUTIVE SHORTLIST
        </p>

        <div className="flex flex-wrap items-baseline justify-between gap-6">
          <div>
            <h1 className="display text-[38px] sm:text-[52px] leading-[1.05] text-foreground font-semibold">
              The shortlist.
            </h1>
            <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground font-normal">
              Showing {visible.length} of {remaining.length} live briefs. Decide on one and the next in the queue takes its slot.
              {queued > 0 && <> <span className="text-foreground font-semibold">{queued}</span> queued.</>}
            </p>
          </div>

          <div className="flex gap-8 border-l border-border pl-6 py-1">
            <Stat label="PURSUED" value={pursue} tint="text-pursue" />
            <Stat label="CONSIDERED" value={consider} tint="text-consider" />
            <Stat label="PASSED" value={pass} tint="text-muted-foreground" />
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────────────
          MAIN SHORTLIST QUEUE
          ──────────────────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-[1180px] px-4 sm:px-8 pt-8 pb-24">
        <div className="flex items-center justify-between mb-4">
          <p className="mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase font-semibold">
            GESTURE CONTROL · SWIPE <span className="text-pursue font-bold">RIGHT TO PURSUE</span>, OR <span className="text-foreground font-bold">LEFT TO PASS</span>
          </p>
          <span className="mono text-[10px] tracking-[0.18em] text-accent-ink uppercase font-semibold">
            QUEUE STATUS · {remaining.length} ACTIVE
          </span>
        </div>

        <ul className="divide-y divide-border border-y border-border">
          {visible.map((o, idx) => (
            <li key={o.jobHash} className="transition-colors">
              <SwipeableRow onDecide={(verb) => decide(o.jobHash, verb)}>
                <Row
                  o={o}
                  index={idx + 1}
                  total={remaining.length}
                  isOpen={open === o.jobHash}
                  onToggle={() => setOpen(open === o.jobHash ? null : o.jobHash)}
                  onDecide={(verb) => decide(o.jobHash, verb)}
                />
              </SwipeableRow>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="py-20 text-center font-serif text-[15px] text-muted-foreground">
              Queue cleared. Hit <span className="text-foreground font-semibold">SEARCH</span> to scan for more, or{" "}
              <Link to="/decisions" className="text-foreground underline underline-offset-4 font-semibold">
                review your decisions
              </Link>.
            </li>
          )}
        </ul>
      </main>

      <ScraperConsole
        runId={activeRunId}
        onClose={() => setActiveRunId(null)}
        onRefreshFeed={handleRefreshFeed}
        onConfirm={confirmScrapeFn}
        onAbort={abortScrapeFn}
      />
    </div>
  );
}

function Row({
  o,
  index,
  total,
  isOpen,
  onToggle,
  onDecide,
}: {
  o: Opportunity;
  index: number;
  total: number;
  isOpen: boolean;
  onToggle: () => void;
  onDecide: (verb: DecisionVerb) => void;
}) {
  const score = o.recommendationResult?.score ?? 80;
  const mandateTag = o.mandateArchetype || "Performance Marketing";

  return (
    <div
      onClick={onToggle}
      className={`cursor-pointer group transition-all duration-200 ${
        isOpen ? "bg-muted/30 border-l-4 border-foreground py-2 my-2 rounded-sm shadow-sm" : ""
      }`}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        aria-expanded={isOpen}
        className="w-full py-3.5 sm:py-4 text-left flex items-center justify-between gap-3 transition-colors group-hover:bg-muted/20 px-2.5 cursor-pointer"
      >
        <div className="min-w-0 flex-1">
          {/* Row 1: Role Title + Badges */}
          <div className="flex items-center gap-2 min-w-0">
            <span className="display text-[15px] sm:text-[18px] font-semibold text-foreground leading-snug tracking-tight truncate">
              {o.role}
            </span>
            <div className="inline-flex items-center gap-1.5 shrink-0">
              <DecisionBadge verb={o.decision} size="sm" />
              <span className="mono text-[9px] tracking-[0.14em] text-accent-ink bg-accent-ink/8 px-1.5 py-0.5 rounded-sm uppercase font-semibold hidden sm:inline-block">
                {mandateTag}
              </span>
            </div>
          </div>

          {/* Row 2: Company • Location • Portal • Relative Date */}
          <p className="mt-1 text-[12px] sm:text-[13px] text-muted-foreground font-normal truncate">
            <span className="text-foreground font-medium">{o.company}</span> · {o.location} ·{" "}
            <span className="mono text-[10px] uppercase tracking-wider">{o.scrapedFrom} · {o.postedRelative}</span>
          </p>
        </div>

        {/* Priority Score & Expand Chevron */}
        <div className="flex items-center gap-3 sm:gap-5 shrink-0">
          <div className="text-right">
            <span className="mono text-[8.5px] sm:text-[9.5px] tracking-[0.18em] text-muted-foreground uppercase font-bold block">
              PRIORITY
            </span>
            <span className="display text-[18px] sm:text-[22px] font-bold text-foreground tabular-nums leading-none">
              {score}<span className="mono text-[9px] sm:text-[10px] text-muted-foreground font-normal">/100</span>
            </span>
          </div>

          <span
            aria-hidden
            className={`mono text-[16px] sm:text-[18px] text-muted-foreground transition-transform duration-300 ${
              isOpen ? "rotate-45 text-foreground font-bold" : "rotate-0 group-hover:text-foreground"
            }`}
          >
            +
          </span>
        </div>
      </button>

      {isOpen && (
        <div className="pb-4 pt-1 px-2.5 animate-fade-in" onClick={(e) => e.stopPropagation()}>
          <div className="border-l-2 border-foreground/15 pl-3 sm:pl-5 my-1 transition-all">
            {/* Active Focus Header Badge */}
            <div className="flex items-center justify-between pb-2.5 mb-2 border-b border-border/50">
              <span className="mono text-[10px] sm:text-[11px] font-bold tracking-[0.16em] uppercase text-foreground bg-foreground/10 px-2.5 py-1 rounded-sm">
                Reviewing {index} of {total}
              </span>
              <span className="mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase font-semibold">
                ACTIVE FOCUS
              </span>
            </div>

            <InlineBrief opportunity={o} />

            {/* Inline Sticky Decision Bar */}
            <div className="sticky bottom-0 z-20 bg-background/95 backdrop-blur-md py-3 px-1 mt-4 border-t border-border/80 flex flex-wrap items-center justify-between gap-3 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="mono text-[9.5px] sm:text-[10px] tracking-[0.18em] uppercase text-muted-foreground font-bold mr-1">
                  YOUR DECISION:
                </span>
                <DecideButton verb="PURSUE" onClick={() => onDecide("PURSUE")} />
                <DecideButton verb="CONSIDER" onClick={() => onDecide("CONSIDER")} />
                <DecideButton verb="PASS" onClick={() => onDecide("PASS")} />
              </div>

              <span className="mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase hidden sm:inline">
                PULLS NEXT BRIEF FROM QUEUE
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tint = "text-foreground" }: { label: string; value: number; tint?: string }) {
  return (
    <div>
      <span className="mono text-[9.5px] tracking-[0.2em] text-muted-foreground uppercase font-bold block mb-1">
        {label}
      </span>
      <span className={`display text-[28px] font-bold tabular-nums leading-none ${tint}`}>
        {value}
      </span>
    </div>
  );
}

function DecideButton({ verb, onClick }: { verb: DecisionVerb; onClick: () => void }) {
  const style =
    verb === "PURSUE"
      ? "border-pursue text-pursue bg-pursue-soft hover:opacity-90 font-bold"
      : verb === "CONSIDER"
        ? "border-consider text-consider bg-consider-soft hover:opacity-90 font-bold"
        : "border-border text-muted-foreground hover:bg-muted font-semibold";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`mono text-[10px] tracking-[0.18em] rounded-sm border px-3 py-1.5 uppercase transition-all ${style}`}
    >
      {verb}
    </button>
  );
}
