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
  const signature = candidateSignature();

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
    if (activeRunId || isStarting) return; // already running or starting
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
    <div className="min-h-screen bg-background text-ink">
      {/* Slim header */}
      <header className="border-b border-hairline">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-6 px-8 py-5">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] uppercase tracking-[0.32em] text-ink">RADAR</span>
            <span className="text-ink-muted">·</span>
            <span className="text-[12.5px] text-ink-muted">Executive advisory</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-[12px] text-ink-muted md:inline">{signature}</span>
            <Link
              to="/decisions"
              className="text-[11.5px] font-medium uppercase tracking-[0.14em] text-ink-muted hover:text-ink"
            >
              Decisions
            </Link>
            <button
              type="button"
              onClick={async () => {
                if (activeRunId || isStarting) {
                  if (activeRunId) await abortScrapeFn({ data: { runId: activeRunId }});
                } else {
                  await runSearch();
                }
              }}
              className="inline-flex items-center gap-2 rounded-sm border border-ink bg-ink px-3 py-1.5 text-[11.5px] font-medium uppercase tracking-[0.14em] text-parchment transition-opacity hover:opacity-90"
            >
              <span
                aria-hidden
                className={`inline-block h-1.5 w-1.5 rounded-full bg-parchment ${activeRunId || isStarting ? "animate-pulse bg-red-500" : ""}`}
              />
              {activeRunId || isStarting ? "Stop" : "Search"}
            </button>
          </div>
        </div>
      </header>

      {/* Scraper strip */}
      <div className="border-b border-hairline bg-muted/40">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-4 px-8 py-3 text-[12.5px]">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-ink-muted">
            <span>
              <span className="font-medium text-ink tabular-nums">{totalScraped}</span> scraped
            </span>
            <span>· LinkedIn <span className="tabular-nums text-ink">{baseCounts.bySource.LinkedIn}</span></span>
            <span>· Naukri <span className="tabular-nums text-ink">{baseCounts.bySource.Naukri}</span></span>
            <span>· Indeed <span className="tabular-nums text-ink">{baseCounts.bySource.Indeed}</span></span>
            <span>→ <span className="tabular-nums text-decision-pursue">{baseCounts.shortlisted}</span> on shortlist</span>
            {lastScanAt && !activeRunId && (
              <span className="text-ink-muted/80">· last scan {lastScanAt}</span>
            )}
          </div>
          <Link to="/scraped" className="text-ink underline-offset-4 hover:underline">
            View feed →
          </Link>
        </div>
      </div>

      {/* Hero */}
      <section className="mx-auto max-w-4xl px-8 pb-10 pt-16">
        <h1 className="text-[42px] font-medium leading-[1.05] tracking-[-0.025em] text-ink">
          The shortlist.
        </h1>
        <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-ink-muted">
          Showing {visible.length} of {remaining.length} live briefs. Decide on one and the next in the queue takes its slot.
          {queued > 0 && <> <span className="text-ink">{queued}</span> queued.</>}
        </p>
        <div className="mt-6 flex gap-8 text-[13px] text-ink-muted">
          <Stat label="Pursued" value={pursue} tint="text-decision-pursue" />
          <Stat label="Considered" value={consider} tint="text-decision-consider" />
          <Stat label="Passed" value={pass} />
        </div>
      </section>

      {/* List with expanding briefs */}
      <main className="mx-auto max-w-4xl px-8 pb-24">
        <p className="mb-3 text-[11.5px] text-ink-muted">
          Swipe a row <span className="text-decision-pursue">right to Pursue</span>, or{" "}
          <span className="text-ink">left to Pass</span>. Or tap to expand and choose Consider.
        </p>
        <ul className="border-t border-hairline">
          {visible.map((o) => (
            <li key={o.jobHash} className="border-b border-hairline">
              <SwipeableRow onDecide={(verb) => decide(o.jobHash, verb)}>
                <Row
                  o={o}
                  isOpen={open === o.jobHash}
                  onToggle={() => setOpen(open === o.jobHash ? null : o.jobHash)}
                  onDecide={(verb) => decide(o.jobHash, verb)}
                />
              </SwipeableRow>
            </li>
          ))}
          {visible.length === 0 && (
            <li className="py-16 text-center text-[13px] text-ink-muted">
              Queue cleared. Hit <span className="text-ink">Search</span> to scan for more, or{" "}
              <Link to="/decisions" className="text-ink underline-offset-4 hover:underline">review your decisions</Link>.
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
  isOpen,
  onToggle,
  onDecide,
}: {
  o: Opportunity;
  isOpen: boolean;
  onToggle: () => void;
  onDecide: (verb: DecisionVerb) => void;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="group grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-5 py-5 text-left transition-colors hover:bg-muted/40"
      >
        <DecisionBadge verb={o.decision} size="sm" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2.5">
            <span className="truncate text-[17px] font-medium tracking-[-0.01em] text-ink">{o.role}</span>
            <span className="text-[13px] text-ink-muted">{o.company}</span>
          </div>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            {o.location} · {o.scrapedFrom} · {o.postedRelative}
          </p>
        </div>
        <span
          aria-hidden
          className={`text-ink-muted transition-transform duration-500 ease-out ${isOpen ? "rotate-45 text-ink" : "rotate-0 group-hover:text-ink"}`}
          style={{ fontSize: 18, lineHeight: 1 }}
        >
          +
        </span>
      </button>

      <div
        className="grid transition-[grid-template-rows,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{ gridTemplateRows: isOpen ? "1fr" : "0fr", opacity: isOpen ? 1 : 0 }}
      >
        <div className="overflow-hidden">
          <div className="pb-8 pt-1">
            {isOpen && (
              <>
                <InlineBrief opportunity={o} />
                <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-hairline pt-5">
                  <span className="mr-2 text-[11px] uppercase tracking-[0.18em] text-ink-muted">Your call</span>
                  <DecideButton verb="PURSUE" onClick={() => onDecide("PURSUE")} />
                  <DecideButton verb="CONSIDER" onClick={() => onDecide("CONSIDER")} />
                  <DecideButton verb="PASS" onClick={() => onDecide("PASS")} />
                  <span className="ml-auto text-[11.5px] text-ink-muted">
                    Deciding removes this brief and pulls the next from the queue.
                  </span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, tint = "text-ink" }: { label: string; value: number; tint?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-[17px] font-medium tabular-nums ${tint}`}>{value}</span>
      <span className="text-[12px] uppercase tracking-[0.14em] text-ink-muted">{label}</span>
    </div>
  );
}

function DecideButton({ verb, onClick }: { verb: DecisionVerb; onClick: () => void }) {
  const style =
    verb === "PURSUE"
      ? "border-decision-pursue/40 text-decision-pursue hover:bg-decision-pursue/10"
      : verb === "CONSIDER"
        ? "border-decision-consider/40 text-decision-consider hover:bg-decision-consider/10"
        : "border-hairline text-ink-muted hover:bg-muted";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`rounded-sm border px-3 py-1.5 text-[11px] font-medium uppercase tracking-[0.14em] transition-colors ${style}`}
    >
      {verb}
    </button>
  );
}
