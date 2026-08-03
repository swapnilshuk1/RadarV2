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
            HERO & PIPELINE LEDGER (MATCHING SHORTLIST.MHTML)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="mx-auto max-w-[1280px] px-4 sm:px-8 py-10 border-b border-border">
          <div className="flex flex-col gap-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className="mono text-[11px] tracking-[0.2em] text-muted-foreground uppercase font-bold">
                TODAY'S EXECUTIVE BRIEFING · {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </div>
              <h1 className="font-serif text-[3.25rem] sm:text-[3.75rem] leading-[0.95] text-foreground font-light mt-3 tracking-tight">
                The shortlist.
              </h1>
            </div>

            <div className="flex flex-wrap items-end gap-x-10 gap-y-5 sm:flex-nowrap">
              <div className="flex items-end gap-4">
                <div>
                  <div className="font-serif leading-none tabular-nums text-[2.25rem] font-light text-foreground/90">{totalScraped}</div>
                  <div className="mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground/80 mt-2 max-w-[8.5rem] leading-relaxed font-semibold">
                    reviewed
                  </div>
                </div>
              </div>
              <span className="text-muted-foreground/30 font-serif text-[22px] mb-2 hidden sm:inline">→</span>
              <div className="flex items-end gap-4">
                <div>
                  <div className="font-serif leading-none tabular-nums text-[3rem] sm:text-[4.25rem] font-medium text-emerald-800">
                    {remaining.filter((o) => o.decision === "PURSUE").length}
                  </div>
                  <div className="mono text-[10px] tracking-[0.18em] uppercase text-foreground mt-2 max-w-[9rem] leading-relaxed font-bold">
                    recommendations to act on
                  </div>
                </div>
              </div>
              <span className="text-muted-foreground/30 font-serif text-[22px] mb-2 hidden sm:inline">→</span>
              <div className="flex items-end gap-4">
                <div>
                  <div className="font-serif leading-none tabular-nums text-[1.75rem] font-light text-muted-foreground/60">{remaining.length}</div>
                  <div className="mono text-[10px] tracking-[0.16em] uppercase text-muted-foreground/60 mt-2 max-w-[8.5rem] leading-relaxed font-normal">
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
        <main className="mx-auto max-w-[1180px] px-3.5 sm:px-8 pt-2 pb-16">
          <div className="flex items-center justify-between border-b border-border/80 pb-2 mb-0">
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
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-2 px-3 sm:px-8 py-1.5 font-mono text-[9.5px] sm:text-[11px] overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-5 gap-y-0.5 text-muted-foreground max-w-full">
            <span>
              <span className="font-bold text-foreground tabular-nums">{totalScraped}</span> SCRAPED
            </span>
            <span className="hidden xs:inline">· LINKEDIN <span className="tabular-nums text-foreground font-semibold">{baseCounts.bySource.LinkedIn}</span></span>
            <span className="hidden xs:inline">· NAUKRI <span className="tabular-nums text-foreground font-semibold">{baseCounts.bySource.Naukri}</span></span>
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
  const brief = BriefCompositionEngine.compose(o);
  const conviction = score >= 92 ? "Exceptional" : score >= 85 ? "Strong" : "Adequate";

  return (
    <article className={`relative transition-colors ${isOpen ? "bg-card shadow-xs" : "hover:bg-muted/15"}`}>
      {isOpen && <span className="absolute inset-y-0 left-0 w-[3px] bg-emerald-800" />}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="flex flex-col sm:flex-row w-full items-start sm:items-stretch gap-4 sm:gap-6 px-4 sm:px-8 py-5 sm:py-6 text-left cursor-pointer"
      >
        <span className="mono w-7 shrink-0 pt-1 text-sm tabular-nums text-muted-foreground/40 hidden md:block font-normal">
          {String(index).padStart(2, "0")}
        </span>

        <div className="min-w-0 flex-1 w-full">
          <div className="flex items-center gap-3">
            <span className={`inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-[2px] font-mono text-[0.5625rem] tracking-[0.16em] uppercase font-bold ${
              o.decision === "PURSUE" ? "bg-emerald-950/5 text-emerald-800 border-emerald-600/30" :
              o.decision === "CONSIDER" ? "bg-amber-950/5 text-amber-800 border-amber-600/30" :
              "bg-muted text-muted-foreground border-border"
            }`}>
              <span className="size-1 rounded-full bg-current" />
              {o.decision}
            </span>
          </div>

          <h2 className="font-serif mt-2 text-[1.35rem] sm:text-[1.625rem] leading-snug text-foreground font-light tracking-tight break-words">
            {o.role}
          </h2>

          <p className="font-serif mt-1 text-[0.95rem] sm:text-[1.0625rem] italic leading-snug text-muted-foreground/85">
            {brief.memory.retentionSentence || "Worth your time first."}
          </p>

          <div className="mono mt-3.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground/65 font-medium">
            <span className="text-foreground font-semibold">{o.company}</span>
            <span>·</span>
            <span>{o.location}</span>
            <span>·</span>
            <span>{o.scrapedFrom}</span>
          </div>

          <div className="mt-3.5 flex flex-col xs:flex-row items-start xs:items-baseline gap-1 xs:gap-2 text-[13.5px] sm:text-[14px] leading-relaxed">
            <span className="font-serif italic text-muted-foreground/60 text-[13px] shrink-0">Why now:</span>
            <span className="font-serif text-foreground/95 font-normal">{o.whyNow || brief.memory.retentionSentence || `Market signal captured from ${o.scrapedFrom}.`}</span>
          </div>

          {(brief.frictionPreview || brief.topUnknownPreview || o.hiringRisk) && (
            <div className="mt-3 inline-flex flex-wrap items-center gap-x-3 gap-y-1 border-l-2 border-amber-600/80 bg-amber-950/5 py-1 px-3 w-full sm:w-auto">
              <span className="mono text-[9px] tracking-[0.16em] text-amber-800 font-bold uppercase">NEEDS VERIFICATION</span>
              <span className="text-[12.5px] leading-snug text-muted-foreground">{brief.topUnknownPreview || brief.frictionPreview || o.hiringRisk}</span>
            </div>
          )}
        </div>

        <div className="w-full sm:w-[10rem] shrink-0 border-t sm:border-t-0 sm:border-l border-border/50 pt-3 sm:pt-0 sm:pl-5 sm:ml-2 text-left flex flex-row sm:flex-col items-center sm:items-start justify-between self-stretch py-0.5 mt-2 sm:mt-0">
          <div>
            <div className="font-serif text-[1.1rem] sm:text-[1.25rem] leading-tight font-medium text-emerald-800">
              {o.decision === "PURSUE" ? "Pursue" : o.decision === "CONSIDER" ? "Consider" : "Pass"}
            </div>
            <div className="font-serif text-[0.85rem] sm:text-[0.875rem] leading-snug font-normal text-muted-foreground mt-0.5">{conviction}</div>
            <div className="mono mt-0.5 sm:mt-1 text-[10px] text-muted-foreground/50 font-medium">Score {score}</div>
          </div>

          <span className="mono mt-0 sm:mt-3 inline-flex items-center gap-1.5 rounded-sm border border-foreground/30 bg-muted/30 px-2.5 py-1 text-[10px] text-foreground font-bold uppercase tracking-wider transition-colors hover:bg-foreground hover:text-background w-fit">
            {isOpen ? "- CLOSE" : "+ BRIEF"}
          </span>
        </div>
      </button>

      {isOpen && (
        <div onClick={(e) => e.stopPropagation()}>
          <InlineBrief opportunity={o} />
        </div>
      )}
    </article>
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
