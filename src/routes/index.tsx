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
import { BriefCompositionEngine } from "../lib/intelligence/editorial/BriefCompositionEngine";

const VISIBLE_LIMIT = 8;

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
        <section className="mx-auto max-w-[1280px] px-4 sm:px-8 py-6 sm:py-10 border-b border-border">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mono text-[10px] sm:text-[11px] tracking-[0.2em] text-muted-foreground uppercase font-bold">
                TODAY'S EXECUTIVE BRIEFING · {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </div>
              <h1 className="font-serif text-[2.5rem] sm:text-[3.75rem] leading-[0.98] text-foreground font-light mt-2 sm:mt-3 tracking-tight">
                The shortlist.
              </h1>
            </div>

            <div className="flex flex-wrap items-end gap-x-6 sm:gap-x-10 gap-y-3">
              <div className="flex items-end gap-3">
                <div>
                  <div className="font-serif leading-none tabular-nums text-[1.85rem] sm:text-[2.25rem] font-light text-foreground/90">{totalScraped}</div>
                  <div className="mono text-[9.5px] sm:text-[10px] tracking-[0.16em] uppercase text-muted-foreground/80 mt-1.5 max-w-[8.5rem] leading-relaxed font-semibold">
                    reviewed
                  </div>
                </div>
              </div>
              <span className="text-muted-foreground/30 font-serif text-[20px] mb-2 hidden sm:inline">→</span>
              <div className="flex items-end gap-3">
                <div>
                  <div className="font-serif leading-none tabular-nums text-[2.75rem] sm:text-[4.25rem] font-medium text-emerald-800">
                    {remaining.filter((o) => o.decision === "PURSUE").length}
                  </div>
                  <div className="mono text-[9.5px] sm:text-[10px] tracking-[0.18em] uppercase text-foreground mt-1.5 max-w-[9rem] leading-relaxed font-bold">
                    recommendations to act on
                  </div>
                </div>
              </div>
              <span className="text-muted-foreground/30 font-serif text-[20px] mb-2 hidden sm:inline">→</span>
              <div className="flex items-end gap-3">
                <div>
                  <div className="font-serif leading-none tabular-nums text-[1.5rem] sm:text-[1.75rem] font-light text-muted-foreground/60">{remaining.length}</div>
                  <div className="mono text-[9.5px] sm:text-[10px] tracking-[0.16em] uppercase text-muted-foreground/60 mt-1.5 max-w-[8.5rem] leading-relaxed font-normal">
                    read this week
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            MAIN SHORTLIST QUEUE
            ──────────────────────────────────────────────────────────────────────── */}
        <main className="mx-auto max-w-[1180px] px-3 sm:px-8 pt-4 pb-16">
          <div className="flex items-center justify-between border-b border-border/80 pb-2 mb-1">
            <span className="mono text-[10px] tracking-[0.18em] text-foreground/80 uppercase font-bold">
              SHORTLIST QUEUE
            </span>
            <span className="mono text-[10px] tracking-[0.16em] text-muted-foreground/70 uppercase font-semibold">
              {remaining.length} AWAITING REVIEW
            </span>
          </div>

          <ul className="divide-y divide-border/60 border-b border-border/80">
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
                Shortlist queue completed!
              </li>
            )}
          </ul>
        </main>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          LIVE PIPELINE METADATA & ACTIONS FOOTER
          ──────────────────────────────────────────────────────────────────────── */}
      <footer className="sticky bottom-0 z-40 border-t border-border/90 bg-background/95 backdrop-blur-md shadow-lg">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-2 px-3 sm:px-8 py-2 font-mono text-[9.5px] sm:text-[11px] overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-5 gap-y-0.5 text-muted-foreground max-w-full">
            <span>
              <span className="font-bold text-foreground tabular-nums">{totalScraped}</span> SCRAPED
            </span>
            <span className="hidden xs:inline">· LINKEDIN <span className="tabular-nums text-foreground font-semibold">{baseCounts.bySource.LinkedIn}</span></span>
            <span className="hidden xs:inline">· NAUKRI <span className="tabular-nums text-foreground font-semibold">{baseCounts.bySource.Naukri}</span></span>
            <span>→ <span className="tabular-nums text-pursue font-bold">{remaining.length}</span> ON SHORTLIST</span>
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
  const mandateTag = o.mandateArchetype || "Executive Mandate";
  const brief = BriefCompositionEngine.compose(o);

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
        className="w-full py-3.5 sm:py-5 text-left flex items-center justify-between gap-3 sm:gap-4 transition-colors group-hover:bg-muted/10 px-2.5 sm:px-4 cursor-pointer"
      >
        <div className="min-w-0 flex-1">
          {/* Row 1: Role Title + Badges */}
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <span className="display text-[15px] sm:text-[18px] font-semibold text-foreground leading-snug tracking-tight">
              {o.role}
            </span>
            <div className="inline-flex items-center gap-1.5 shrink-0">
              <DecisionBadge verb={o.decision} size="sm" />
              <span className="mono text-[9px] tracking-[0.14em] text-accent-ink bg-accent-ink/8 px-1.5 py-0.5 rounded-sm uppercase font-semibold hidden sm:inline-block">
                {mandateTag}
              </span>
            </div>
          </div>

          {/* Row 2: Company • Location • Portal */}
          <p className="mt-1 flex flex-wrap items-center gap-1.5 mono text-[9px] sm:text-[9.5px] uppercase tracking-[0.18em] text-muted-foreground font-bold truncate">
            <span>{o.company}</span>
            <span>·</span>
            <span>{o.location}</span>
            <span>·</span>
            <span className="text-foreground">{o.scrapedFrom}</span>
          </p>

          {/* Row 3: Semantic Retention Sentence */}
          <p className="mt-2 font-serif italic text-[13.5px] sm:text-[15.5px] text-muted-foreground/90 leading-snug sm:leading-relaxed">
            {brief.memory.retentionSentence || o.whyNow}
          </p>

          {/* Row 4: Friction & Verification Badges */}
          {(brief.frictionPreview || brief.topUnknownPreview) && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {brief.frictionPreview && (
                <span className="mono text-[8.5px] sm:text-[9px] tracking-[0.12em] text-consider uppercase font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-consider shrink-0"></span>
                  {brief.frictionPreview}
                </span>
              )}
              {brief.topUnknownPreview && (
                <span className="mono text-[8.5px] sm:text-[9px] tracking-[0.12em] text-muted-foreground uppercase font-bold flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground shrink-0"></span>
                  Needs verification: {brief.topUnknownPreview}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Score & Expand Chevron */}
        <div className="flex items-center gap-2.5 sm:gap-4 shrink-0">
          <div className="text-right">
            <span className="display text-[20px] sm:text-[28px] font-bold text-foreground tabular-nums leading-none">
              {score}<span className="mono text-[9px] text-muted-foreground font-normal ml-0.5">/100</span>
            </span>
          </div>

          <span
            aria-hidden
            className={`mono text-[14px] sm:text-[18px] text-muted-foreground transition-transform duration-300 ${
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
            {/* Header Controls */}
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

            <InlineBrief opportunity={o} />
          </div>
        </div>
      )}
    </div>
  );
}
