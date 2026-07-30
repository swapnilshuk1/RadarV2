import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { type Opportunity, type DecisionVerb } from "../data/opportunity-fixtures";
import { candidateSignature } from "../lib/personalization";
import { DecisionBadge } from "../components/radar/DecisionBadge";
import { InlineBrief } from "../components/radar/InlineBrief";
import { SwipeableRow } from "../components/radar/SwipeableRow";
import { useDecisions } from "../lib/decisions-store";
import { getOpportunitiesFn, injectFreshFn } from "../lib/intelligence/opportunity-server";
import { getScrapedJobs, getScraperCounts } from "../data/scraped-jobs";
import { triggerScrapeFn, getLiveScrapedFn, confirmScrapeFn, abortScrapeFn } from "../lib/intelligence/scrape-server";
import { ScraperConsole } from "../components/radar/ScraperConsole";
import { EditorialEngine } from "../lib/intelligence/editorial/EditorialEngine";

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
  loader: async () => {
    return {
      opportunitiesList: await getOpportunitiesFn()
    };
  },
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
  const router = useRouter();

  const baseCounts = getScraperCounts();
  const { opportunitiesList } = Route.useLoaderData();

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
        await injectFreshFn({ data: freshRecords });
        router.invalidate();
      }
    } catch (err) {
      console.error("Failed to fetch fresh records, falling back:", err);
    }
    setLastScanAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
    setExtraScraped((prev) => prev + 1);
  };

  const totalScraped = baseCounts.total + extraScraped;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col justify-between">
      <div className="flex-1">
        {/* ────────────────────────────────────────────────────────────────────────
            HERO & PIPELINE LEDGER
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1180px] px-3.5 sm:px-8 pt-3 sm:pt-6 pb-2.5 sm:pb-4 border-b border-border">
          <p className="mono text-[9px] sm:text-[10px] tracking-[0.2em] text-muted-foreground mb-1 uppercase font-semibold">
            PIPELINE LEDGER & EXECUTIVE SHORTLIST
          </p>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-6">
            <div>
              <h1 className="display text-[22px] sm:text-[36px] leading-tight text-foreground font-semibold">
                The shortlist.
              </h1>
              <p className="mt-0.5 max-w-xl text-[12px] sm:text-[14px] leading-relaxed text-muted-foreground font-normal">
                Showing {visible.length} of {remaining.length} live briefs. Decide on one and the next in the queue takes its slot.
                {queued > 0 && <> <span className="text-foreground font-semibold">{queued}</span> queued.</>}
              </p>
            </div>

            <div className="flex items-center gap-5 sm:gap-7 border-t sm:border-t-0 sm:border-l border-border pt-2 sm:pt-0 pl-0 sm:pl-6 mt-0.5 sm:mt-0">
              <Stat label="PURSUED" value={pursue} tint="text-pursue" />
              <Stat label="CONSIDERED" value={consider} tint="text-consider" />
              <Stat label="PASSED" value={pass} tint="text-muted-foreground" />
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            MAIN SHORTLIST QUEUE
            ──────────────────────────────────────────────────────────────────────── */}
        <main className="mx-auto max-w-[1180px] px-3.5 sm:px-8 pt-3 sm:pt-6 pb-12">
          <div className="flex items-center justify-between mb-2.5 sm:mb-3.5 gap-2">
            <p className="mono text-[9px] sm:text-[10px] tracking-[0.16em] text-muted-foreground uppercase font-semibold truncate">
              GESTURE CONTROL · SWIPE <span className="text-pursue font-bold">RIGHT TO PURSUE</span>, OR <span className="text-foreground font-bold">LEFT TO PASS</span>
            </p>
            <span className="mono text-[9px] sm:text-[10px] tracking-[0.14em] text-accent-ink uppercase font-semibold shrink-0">
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
                    onPrev={idx > 0 ? () => setOpen(visible[idx - 1].jobHash) : undefined}
                    onNext={idx < visible.length - 1 ? () => setOpen(visible[idx + 1].jobHash) : undefined}
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
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          LIVE PIPELINE METADATA & ACTIONS FOOTER
          ──────────────────────────────────────────────────────────────────────── */}
      <footer className="sticky bottom-0 z-40 border-t border-border/90 bg-background/95 backdrop-blur-md shadow-lg">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-2 px-3.5 sm:px-8 py-2 font-mono text-[10px] sm:text-[11px]">
          <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-5 gap-y-0.5 text-muted-foreground">
            <span>
              <span className="font-bold text-foreground tabular-nums">{totalScraped}</span> SCRAPED
            </span>
            <span>· LINKEDIN <span className="tabular-nums text-foreground font-semibold">{baseCounts.bySource.LinkedIn}</span></span>
            <span>· NAUKRI <span className="tabular-nums text-foreground font-semibold">{baseCounts.bySource.Naukri}</span></span>
            <span>· INDEED <span className="tabular-nums text-foreground font-semibold">{baseCounts.bySource.Indeed}</span></span>
            <span>→ <span className="tabular-nums text-pursue font-bold">{remaining.length}</span> ON SHORTLIST</span>
            {lastScanAt && !activeRunId && (
              <span className="text-muted-foreground/80 hidden lg:inline">· LAST SCAN {lastScanAt}</span>
            )}
          </div>
          <div className="flex items-center gap-3 ml-auto sm:ml-0">
            <button
              type="button"
              onClick={async () => {
                if (activeRunId || isStarting) {
                  if (activeRunId) await abortScrapeFn({ data: { runId: activeRunId } });
                } else {
                  await runSearch();
                }
              }}
              className="mono text-[10px] tracking-[0.2em] font-bold inline-flex items-center gap-1.5 rounded-sm border border-foreground bg-foreground px-2.5 py-1 text-background uppercase transition-opacity hover:opacity-90 cursor-pointer"
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
      </footer>

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
  onPrev,
  onNext,
}: {
  o: Opportunity;
  index: number;
  total: number;
  isOpen: boolean;
  onToggle: () => void;
  onDecide: (verb: DecisionVerb) => void;
  onPrev?: () => void;
  onNext?: () => void;
}) {
  const score = o.recommendationResult?.score ?? 80;
  const mandateTag = o.mandateArchetype || "Performance Marketing";
  const ed = EditorialEngine.process(o);

  return (
    <div
      onClick={onToggle}
      className={`cursor-pointer group transition-all duration-200 ${
        isOpen ? "bg-card border-l-4 border-foreground shadow-md ring-1 ring-border/80 my-2.5 rounded-md" : ""
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
        className="w-full py-3 sm:py-3.5 text-left flex items-center justify-between gap-3 transition-colors group-hover:bg-muted/20 px-2.5 cursor-pointer"
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

          {/* Row 2: Company • Location • Portal • Compensation Target */}
          <p className="mt-0.5 text-[12px] sm:text-[13px] text-muted-foreground font-normal truncate">
            <span className="text-foreground font-bold">{o.company}</span> · {o.location} ·{" "}
            <span className="mono text-[10px] uppercase tracking-wider">{o.scrapedFrom} · Target: ₹80L INR</span>
          </p>

          {/* Row 3: Primary Focus Reasoning Sentence */}
          <p className="mt-1 text-[12.5px] text-foreground/90 font-medium flex items-center gap-1.5 truncate">
            <span className="mono text-[9px] tracking-[0.12em] bg-accent-ink/10 text-accent-ink px-1.5 py-0.5 rounded-sm uppercase font-bold shrink-0">
              {ed.focusTitle}
            </span>
            <span className="truncate">{ed.headline}</span>
          </p>

          {/* Row 4: Friction & Top Unknown Badges */}
          {(ed.frictionPreview || ed.topUnknownPreview) && (
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {ed.frictionPreview && (
                <span className="mono text-[9px] tracking-[0.1em] text-consider bg-consider-soft px-2 py-0.5 rounded-sm font-semibold">
                  {ed.frictionPreview}
                </span>
              )}
              {ed.topUnknownPreview && (
                <span className="mono text-[9px] tracking-[0.1em] text-muted-foreground bg-muted border border-border px-2 py-0.5 rounded-sm font-semibold">
                  {ed.topUnknownPreview}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Score & Expand Chevron */}
        <div className="flex items-center gap-3 sm:gap-4 shrink-0">
          <div className="text-right">
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
        <div className="pb-3 pt-1 px-2.5 animate-fade-in" onClick={(e) => e.stopPropagation()}>
          <div className="border-l-2 border-foreground/20 pl-2.5 sm:pl-4 my-1 transition-all">
            {/* Header Badge */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/40">
              <span className="mono text-[10px] sm:text-[11px] font-bold tracking-[0.16em] uppercase text-muted-foreground">
                Reviewing {String(index).padStart(2, "0")} of {total}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={!onPrev}
                  onClick={(e) => {
                    e.stopPropagation();
                    onPrev?.();
                  }}
                  className="mono text-[10px] font-bold px-2 py-0.5 rounded border border-border/80 bg-muted/30 hover:bg-muted/80 text-foreground disabled:opacity-25 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  title="Previous brief"
                >
                  ← PREV
                </button>
                <button
                  type="button"
                  disabled={!onNext}
                  onClick={(e) => {
                    e.stopPropagation();
                    onNext?.();
                  }}
                  className="mono text-[10px] font-bold px-2 py-0.5 rounded border border-border/80 bg-muted/30 hover:bg-muted/80 text-foreground disabled:opacity-25 disabled:cursor-not-allowed transition-colors cursor-pointer"
                  title="Next brief"
                >
                  NEXT →
                </button>
              </div>
            </div>

            {/* Elevated Hero Decision Bar */}
            <div className="bg-muted/30 p-2 sm:p-2.5 rounded-sm border border-border/60 flex flex-wrap items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-1.5 sm:gap-2">
                <span className="mono text-[9px] sm:text-[10px] tracking-[0.16em] uppercase text-muted-foreground font-bold mr-1">
                  YOUR DECISION:
                </span>
                <DecideButton verb="PURSUE" onClick={() => onDecide("PURSUE")} />
                <DecideButton verb="CONSIDER" onClick={() => onDecide("CONSIDER")} />
                <DecideButton verb="PASS" onClick={() => onDecide("PASS")} />
              </div>

              <span className="mono text-[8.5px] sm:text-[9.5px] tracking-[0.14em] text-muted-foreground uppercase hidden sm:inline font-medium">
                PULLS NEXT BRIEF FROM QUEUE
              </span>
            </div>

            <InlineBrief opportunity={o} />
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tint = "text-foreground" }: { label: string; value: number; tint?: string }) {
  return (
    <div>
      <span className="mono text-[9px] tracking-[0.18em] text-muted-foreground uppercase font-bold block mb-0.5">
        {label}
      </span>
      <span className={`display text-[24px] sm:text-[28px] font-bold tabular-nums leading-none ${tint}`}>
        {value}
      </span>
    </div>
  );
}

function DecideButton({ verb, onClick }: { verb: DecisionVerb; onClick: () => void }) {
  const style =
    verb === "PURSUE"
      ? "border-pursue text-pursue bg-pursue-soft hover:bg-pursue/20 font-bold shadow-sm"
      : verb === "CONSIDER"
        ? "border-consider text-consider bg-consider-soft hover:bg-consider/20 font-bold shadow-sm"
        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted font-semibold";

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`mono text-[10px] sm:text-[10.5px] tracking-[0.18em] rounded-sm border px-3 sm:px-3.5 py-1 sm:py-1.5 uppercase transition-all cursor-pointer ${style}`}
    >
      {verb}
    </button>
  );
}
