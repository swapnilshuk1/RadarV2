import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { type Opportunity, type DecisionVerb } from "../data/opportunity-fixtures";
import { InlineBrief } from "../components/radar/InlineBrief";
import { useDecisions } from "../lib/decisions-store";
import { getOpportunitiesFn, injectFreshFn } from "../lib/intelligence/opportunity-server";
import { getScraperCounts } from "../data/scraped-jobs";
import { triggerScrapeFn, getLiveScrapedFn, confirmScrapeFn, abortScrapeFn } from "../lib/intelligence/scrape-server";
import { ScraperConsole } from "../components/radar/ScraperConsole";
import { BriefCompositionEngine } from "../lib/intelligence/editorial/BriefCompositionEngine";

const VISIBLE_LIMIT = 10;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "The Shortlist — RADAR Executive Advisory" },
      { name: "description", content: "Today's executive briefing: six mandates cleared the bar. Pursue, consider or pass." },
      { property: "og:title", content: "The Shortlist — RADAR Executive Advisory" },
      { property: "og:description", content: "Today's executive briefing: six mandates cleared the bar. Pursue, consider or pass." },
    ],
  }),
  loader: async () => {
    return {
      opportunitiesList: await getOpportunitiesFn(),
    };
  },
  component: Shortlist,
});

function Shortlist() {
  const { decisions, decide: recordDecision } = useDecisions();
  const [open, setOpen] = useState<string | null>(null);

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [extraScraped, setExtraScraped] = useState(0);
  const router = useRouter();

  const baseCounts = getScraperCounts();
  const { opportunitiesList } = Route.useLoaderData();

  const remaining = useMemo(
    () => opportunitiesList.filter((o) => !decisions[o.jobHash]),
    [opportunitiesList, decisions]
  );
  const visible = remaining.slice(0, VISIBLE_LIMIT);

  const decide = (jobHash: string, verb: DecisionVerb) => {
    recordDecision(jobHash, verb);
    setOpen((cur) => (cur === jobHash ? null : cur));
  };

  const [isStarting, setIsStarting] = useState(false);

  const runSearch = async () => {
    if (activeRunId || isStarting) return;
    setIsStarting(true);
    try {
      const result = await triggerScrapeFn();
      if (result.success && result.runId) {
        setActiveRunId(result.runId);
      } else {
        alert(`Scraping failed: ${result.error}`);
      }
    } catch (err: any) {
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
      console.error("Failed to fetch fresh records:", err);
    }
    setExtraScraped((prev) => prev + 1);
  };

  const totalScraped = baseCounts.total + extraScraped;

  return (
    <div className="min-h-screen pb-24 bg-background text-foreground font-sans">
      <main className="mx-auto max-w-[1180px] px-5 sm:px-8">
        {/* ────────────────────────────────────────────────────────────────────────
            HEADER BRIEFING SUMMARY
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-8 border-b border-border py-9 sm:py-12 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div className="min-w-0">
            <p className="label-mono font-normal" suppressHydrationWarning>
              Today's executive briefing · {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
            </p>
            <h1 className="mt-3 font-display text-[3.25rem] leading-[0.92] tracking-tight sm:text-7xl text-foreground font-normal">
              The shortlist.
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted-foreground font-normal">
              Six mandates cleared the bar out of {totalScraped} scraped this week. Decide on one and the next in line takes its slot.
            </p>
          </div>

          <dl className="flex items-end gap-4 overflow-x-auto sm:gap-7">
            <div className="flex shrink-0 items-end gap-4 sm:gap-7">
              <div>
                <dd className="font-display text-4xl leading-none sm:text-5xl text-foreground tabular-nums font-normal">
                  40
                </dd>
                <dt className="label-mono mt-2 block font-normal">Reviewed</dt>
              </div>
            </div>

            <div className="flex shrink-0 items-end gap-4 sm:gap-7">
              <span className="pb-3 font-mono text-xs text-border-strong">→</span>
              <div>
                <dd className="font-display text-4xl leading-none sm:text-5xl text-primary tabular-nums font-normal">
                  {remaining.filter((o) => o.decision === "PURSUE").length || 6}
                </dd>
                <dt className="label-mono mt-2 block font-normal text-primary">To act on</dt>
              </div>
            </div>

            <div className="flex shrink-0 items-end gap-4 sm:gap-7">
              <span className="pb-3 font-mono text-xs text-border-strong">→</span>
              <div>
                <dd className="font-display text-4xl leading-none sm:text-5xl text-muted-foreground/70 tabular-nums font-normal">
                  {totalScraped}
                </dd>
                <dt className="label-mono mt-2 block font-normal">Read this week</dt>
              </div>
            </div>
          </dl>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SHORTLIST QUEUE
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="py-6 sm:py-8">
          <div className="flex items-center justify-between gap-3 pb-3">
            <h2 className="label-mono text-foreground font-normal">Shortlist queue · sorted by fit</h2>
            <span className="label-mono font-normal">{remaining.length} awaiting review</span>
          </div>

          <ul className="border-t border-border">
            {visible.map((o, idx) => {
              const isOpen = open === o.jobHash;
              const brief = BriefCompositionEngine.compose(o, { bypassHistory: true });
              const score = o.recommendationResult?.score ?? 80;

              return (
                <li key={o.jobHash} className="border-b border-border">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => setOpen(isOpen ? null : o.jobHash)}
                    className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-4 py-3.5 text-left transition-colors sm:gap-8 cursor-pointer hover:bg-muted/10"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                        <span className="label-mono tabular-nums text-border-strong font-normal">
                          {(idx + 1).toString().padStart(2, "0")}
                        </span>
                        <span className="font-display text-2xl leading-tight sm:text-[1.7rem] text-foreground font-normal">
                          {o.role}
                        </span>
                        <span className={`label-mono shrink-0 rounded-[3px] px-1.5 py-[3px] leading-none font-normal uppercase ${
                          o.decision === "CONSIDER" ? "bg-caution text-white" : o.decision === "PASS" ? "bg-muted text-muted-foreground" : "bg-signal text-white"
                        }`}>
                          {o.decision?.toLowerCase() || "pursue"}
                        </span>
                        <span className="label-mono hidden rounded-[3px] bg-secondary px-1.5 py-[3px] leading-none sm:inline font-normal">
                          {o.mandateArchetype || "Growth Marketing"}
                        </span>
                      </span>

                      <span className="label-mono mt-2 block truncate font-normal">
                        {o.company} · {o.location} ({(o as any).workModel || "On-site"}) · {o.scrapedFrom}
                      </span>

                      <span className="mt-2 block max-w-2xl font-display text-base italic leading-snug text-muted-foreground font-normal">
                        {brief.memory.retentionSentence || o.whyNow}
                      </span>

                      {(brief.frictionPreview || brief.topUnknownPreview) && (
                        <span className="mt-2.5 flex items-center gap-2">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
                          <span className="label-mono truncate text-destructive font-normal">
                            Needs verification: {brief.frictionPreview || brief.topUnknownPreview}
                          </span>
                        </span>
                      )}
                    </span>

                    <span className="flex shrink-0 flex-col items-end gap-2">
                      <span className="flex shrink-0 items-baseline gap-0.5 tabular-nums">
                        <span className="font-display text-3xl leading-none text-foreground font-normal">{score}</span>
                        <span className="font-mono text-[0.6rem] text-muted-foreground font-normal">/100</span>
                      </span>
                      <span className="label-mono transition-colors group-hover:text-foreground font-normal">
                        {isOpen ? "— Close" : "+ Brief"}
                      </span>
                    </span>
                  </button>

                  {/* Expanded Brief Drawer */}
                  {isOpen && (
                    <InlineBrief opportunity={o} onDecide={(verb) => decide(o.jobHash, verb)} />
                  )}
                </li>
              );
            })}

            {visible.length === 0 && (
              <li className="py-16 text-center font-display text-xl text-muted-foreground">
                All shortlist items reviewed!
              </li>
            )}
          </ul>
        </section>
      </main>

      {/* ────────────────────────────────────────────────────────────────────────
          FOOTER STATUS BAR
          ──────────────────────────────────────────────────────────────────────── */}
      <footer className="fixed inset-x-0 bottom-0 border-t border-border bg-background/90 py-2.5 backdrop-blur-md z-40">
        <div className="mx-auto flex max-w-[1180px] items-center gap-x-5 gap-y-1 overflow-x-auto px-5 sm:px-8">
          <span className="label-mono shrink-0 font-bold">
            <span className="text-foreground font-mono">{totalScraped}</span> scraped
          </span>
          <span className="label-mono hidden shrink-0 sm:inline">
            LinkedIn <span className="text-foreground font-mono font-bold">{baseCounts.bySource.LinkedIn}</span>
          </span>
          <span className="label-mono hidden shrink-0 sm:inline">
            Naukri <span className="text-foreground font-mono font-bold">{baseCounts.bySource.Naukri}</span>
          </span>
          <span className="label-mono hidden shrink-0 sm:inline">
            Indeed <span className="text-foreground font-mono font-bold">{baseCounts.bySource.Indeed}</span>
          </span>
          <span className="label-mono ml-auto shrink-0 text-primary font-bold">
            → {remaining.length} on shortlist
          </span>
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
