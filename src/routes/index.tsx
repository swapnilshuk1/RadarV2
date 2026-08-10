import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { type Opportunity, type DecisionVerb } from "../data/opportunity-fixtures";
import { InlineBrief } from "../components/radar/InlineBrief";
import { useDecisions } from "../lib/decisions-store";
import { getOpportunitiesFn, injectFreshFn } from "../lib/intelligence/opportunity-server";
import { getScraperCounts } from "../data/scraped-jobs";
import { triggerScrapeFn, getLiveScrapedFn, confirmScrapeFn, abortScrapeFn } from "../lib/intelligence/scrape-server";
import { ScraperConsole } from "../components/radar/ScraperConsole";
import { BriefCompositionEngine } from "../lib/intelligence/editorial/BriefCompositionEngine";
import { JobProjectionBuilder } from "../lib/intelligence/builders/JobProjectionBuilder";
import { logTelemetry } from "../lib/telemetry";
import { useOnboarding } from "../components/onboarding/OnboardingProvider";
import { inferExecutiveMandateArchetype } from "../lib/intelligence/editorial";

const VISIBLE_LIMIT = 10;

function getCategoryTags(o: Opportunity): string[] {
  const tags = ["All"];
  const jobProj = JobProjectionBuilder.build(o);

  const mandate = jobProj.trueExecutiveMandate || "COMMERCIAL_EXPANSION";
  const intent = jobProj.executiveMission?.intent || "ACCELERATE_GROWTH";
  const title = (o.role || "").toLowerCase();
  const rawText = (o.role + " " + (o as any).description + " " + o.recommendation).toLowerCase();

  // 1. Transformation
  if (mandate === "TRANSFORMATION" || mandate === "TURNAROUND" || rawText.includes("transformation") || rawText.includes("modernize") || rawText.includes("overhaul")) {
    tags.push("Transformation");
  }

  // 2. Commercial Growth
  if (mandate === "SCALE" || mandate === "COMMERCIAL_EXPANSION" || intent === "ACCELERATE_GROWTH" || intent === "EXPAND_GEOGRAPHY" || rawText.includes("growth") || rawText.includes("revenue") || rawText.includes("commercial") || rawText.includes("sales")) {
    tags.push("Commercial Growth");
  }

  // 3. Country Leadership
  if (intent === "EXPAND_GEOGRAPHY" || title.includes("country") || title.includes("regional") || title.includes("general manager") || title.includes("managing director") || title.includes("head of") || title.includes("national")) {
    tags.push("Country Leadership");
  }

  // 4. Platform & Digital
  const hasPlatformKeywords = ["platform", "digital", "technology", "crm", "salesforce", "sfmc", "cdp", "product", "software", "saas", "tech"].some(kw => rawText.includes(kw));
  if (hasPlatformKeywords) {
    tags.push("Platform & Digital");
  }

  // 5. Founder-led
  if (intent === "PROFESSIONALIZE_FOUNDER_COMPANY" || rawText.includes("founder") || rawText.includes("co-founder") || rawText.includes("bootstrapped") || rawText.includes("first hire")) {
    tags.push("Founder-led");
  }

  // 6. Private Equity
  if (intent === "PREPARE_IPO" || intent === "INTEGRATE_ACQUISITION" || rawText.includes("private equity") || rawText.includes("portfolio company") || rawText.includes("venture capital") || rawText.includes("pe-backed") || rawText.includes("vc-backed") || rawText.includes("ipo")) {
    tags.push("Private Equity");
  }

  return tags;
}

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
  const { progress, markArrivalSeen } = useOnboarding();
  const [open, setOpen] = useState<string | null>(null);
  const [openedTimes, setOpenedTimes] = useState<Record<string, number>>({});

  const showArrivalBanner = !progress.arrivalSeen;
  const isBothSkipped = progress.evidenceStatus === "skipped" && progress.intentStatus === "skipped";

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [extraScraped, setExtraScraped] = useState(0);
  const router = useRouter();

  const baseCounts = getScraperCounts();
  const { opportunitiesList } = Route.useLoaderData();

  const [selectedCategory, setSelectedCategory] = useState("All");

  const remaining = useMemo(
    () => opportunitiesList.filter((o) => !decisions[o.jobHash]),
    [opportunitiesList, decisions]
  );

  const filteredRemaining = useMemo(() => {
    if (selectedCategory === "All") return remaining;
    return remaining.filter(o => getCategoryTags(o).includes(selectedCategory));
  }, [remaining, selectedCategory]);

  const visible = filteredRemaining.slice(0, VISIBLE_LIMIT);

  const decide = (jobHash: string, verb: DecisionVerb) => {
    const openTime = openedTimes[jobHash];
    const duration = openTime ? Date.now() - openTime : 0;
    logTelemetry(jobHash, verb, duration);

    recordDecision(jobHash, verb);
    setOpen((cur) => (cur === jobHash ? null : cur));

    setOpenedTimes((prev) => {
      const next = { ...prev };
      delete next[jobHash];
      return next;
    });
  };

  const [isStarting, setIsStarting] = useState(false);

  const runSearch = async () => {
    if (activeRunId || isStarting) return;
    setIsStarting(true);

    try {
      const res = await triggerScrapeFn();
      if (res.success && res.runId) {
        setActiveRunId(res.runId);
      }
    } catch (err: any) {
      console.error("Failed to start scrape run:", err);
      alert("Failed to start scrape: " + err.message);
    } finally {
      setIsStarting(false);
    }
  };

  const handleScrapeComplete = async (payload: { runId: string; opportunities: any[] }) => {
    setActiveRunId(null);
    try {
      await confirmScrapeFn({ data: { runId: payload.runId } });
      const freshRecords = payload.opportunities.map((o) => ({
        id: o.id || `scraped_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        job_hash: o.jobHash || o.job_hash || String(Math.random()),
        canonical_title: o.canonicalTitle || o.title || o.role || "Executive Role",
        role: o.role || "Executive Role",
        company: o.company || "Target Company",
        location: o.location || "Remote",
        recommendation: o.recommendation || "CONSIDER",
        fit_rationale: o.fitRationale || o.recommendation || "",
        raw_description: o.description || ""
      }));

      if (freshRecords.length > 0) {
        await injectFreshFn({ data: freshRecords });
        router.invalidate();
      }
    } catch (err) {
      console.error("Failed to fetch fresh records:", err);
    }
    setExtraScraped((prev) => prev + 1);
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

  const totalScraped = Math.max(opportunitiesList.length, baseCounts.total) + extraScraped;

  return (
    <div className="min-h-screen pb-28 bg-background text-foreground font-sans">
      <main className="mx-auto max-w-[1180px] px-5 sm:px-8 pt-4">
        {/* ────────────────────────────────────────────────────────────────────────
            HEADER BRIEFING SUMMARY
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="glass-card rounded-xl p-6 sm:p-8 grid gap-8 border border-border/60 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end shadow-xs animate-reveal">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
              <p className="label-mono font-medium text-muted-foreground" suppressHydrationWarning>
                Executive Briefing · {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
              </p>
            </div>
            <h1 className="mt-2 font-display text-[3.25rem] leading-[0.92] tracking-tight sm:text-6xl text-foreground font-normal">
              The shortlist.
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground font-normal">
              Six mandates cleared the bar out of <span className="font-mono text-foreground font-semibold">{totalScraped}</span> scraped this week. Decide on one and the next in line takes its slot.
            </p>
          </div>

          <dl className="flex items-center gap-6 overflow-x-auto sm:gap-8">
            <div className="border-r border-border/40 pr-6 sm:pr-8">
              <dd className="font-display text-4xl sm:text-5xl text-emerald-600 dark:text-emerald-400 tabular-nums font-normal">
                {String(remaining.filter((o) => o.decision === "PURSUE").length || 6).padStart(2, "0")}
              </dd>
              <dt className="label-mono mt-1 text-[0.68rem] text-emerald-700 dark:text-emerald-300 font-semibold uppercase tracking-wider">Cleared</dt>
            </div>

            <div className="border-r border-border/40 pr-6 sm:pr-8">
              <dd className="font-display text-4xl sm:text-5xl text-foreground tabular-nums font-normal">
                {Object.keys(decisions).length}
              </dd>
              <dt className="label-mono mt-1 text-[0.68rem] text-muted-foreground font-semibold uppercase tracking-wider">Reviewed</dt>
            </div>

            <div>
              <dd className="font-display text-4xl sm:text-5xl text-muted-foreground tabular-nums font-normal">
                {totalScraped}
              </dd>
              <dt className="label-mono mt-1 text-[0.68rem] text-muted-foreground font-semibold uppercase tracking-wider">Screened</dt>
            </div>
          </dl>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            EXECUTIVE RECOMMENDATION ARRIVAL BANNER (ONBOARDING STAGE 5)
            ──────────────────────────────────────────────────────────────────────── */}
        {showArrivalBanner && (
          <section className="mt-6 border-l-4 border-emerald-500 glass-card p-6 rounded-lg border border-border/60 animate-reveal">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="space-y-1.5 max-w-2xl">
                <span className="mono text-[10px] tracking-[0.22em] font-bold uppercase text-emerald-600 dark:text-emerald-400 block">
                  ◆ EXECUTIVE RECOMMENDATION ARRIVAL
                </span>
                <h2 className="font-serif text-2xl text-foreground font-normal tracking-tight">
                  {isBothSkipped
                    ? "RADAR is ready — but your profile isn't complete yet."
                    : "Here's what RADAR thinks is worth your attention."}
                </h2>
                <p className="font-serif text-sm italic text-muted-foreground leading-relaxed">
                  {isBothSkipped
                    ? "Upload your CV and set your career direction to get personalized recommendations calibrated to your scale and intent."
                    : "We evaluated the available opportunities against your experience and career direction. Start with the strongest match."}
                </p>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                {isBothSkipped ? (
                  <Link
                    to="/profile"
                    className="mono text-[11px] font-bold uppercase tracking-wider bg-foreground text-background px-4 py-2.5 rounded-full hover:opacity-90 transition-opacity shadow-xs"
                  >
                    Complete setup →
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => markArrivalSeen()}
                    className="mono text-[11px] font-bold uppercase tracking-wider bg-foreground text-background px-4 py-2.5 rounded-full hover:opacity-90 transition-opacity cursor-pointer shadow-xs"
                  >
                    Got it →
                  </button>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ────────────────────────────────────────────────────────────────────────
            SHORTLIST QUEUE
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="py-6 sm:py-8">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/60 mb-6">
            <div>
              <h2 className="label-mono text-foreground font-semibold tracking-wider">Shortlist queue · sorted by fit</h2>
              <span className="label-mono text-xs text-muted-foreground mt-0.5 block">
                {filteredRemaining.length} opportunities evaluated by RADAR
              </span>
            </div>

            {/* Human-Friendly Category Filters */}
            <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto p-1 bg-muted/40 rounded-full border border-border/40">
              {["All", "Transformation", "Commercial Growth", "Country Leadership", "Platform & Digital", "Founder-led", "Private Equity"].map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-[0.65rem] font-mono uppercase tracking-wider px-3 py-1 transition-all rounded-full cursor-pointer ${
                    selectedCategory === cat
                      ? "bg-foreground text-background font-bold shadow-xs"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>

          <ul className="space-y-3">
            {visible.map((o, idx) => {
              const isOpen = open === o.jobHash;
              const brief = BriefCompositionEngine.compose(o, { bypassHistory: true });

              return (
                <ShortlistCardRow
                  key={o.jobHash}
                  o={o}
                  idx={idx}
                  isOpen={isOpen}
                  openedTimes={openedTimes}
                  setOpenedTimes={setOpenedTimes}
                  setOpen={setOpen}
                  decide={decide}
                  showArrivalBanner={showArrivalBanner}
                />
              );
            })}

            {visible.length === 0 && (
              <li className="glass-card rounded-xl py-16 text-center font-display text-xl text-muted-foreground">
                {selectedCategory === "All" 
                  ? "All shortlist items reviewed!" 
                  : `No opportunities on the shortlist match "${selectedCategory}".`}
              </li>
            )}
          </ul>
        </section>
      </main>

      {/* ────────────────────────────────────────────────────────────────────────
          FLOATING FOOTER STATUS BAR
          ──────────────────────────────────────────────────────────────────────── */}
      <footer className="fixed inset-x-0 bottom-4 z-40 flex justify-center px-4 pointer-events-none">
        <div className="glass-card rounded-full px-5 py-2 flex items-center gap-4 text-xs shadow-lg border border-border/60 pointer-events-auto backdrop-blur-xl">
          <button
            type="button"
            onClick={runSearch}
            disabled={isStarting || !!activeRunId}
            className={`label-mono shrink-0 font-bold px-3 py-1 rounded-full transition-all flex items-center gap-1.5 text-[10px] cursor-pointer shadow-xs ${
              activeRunId
                ? "bg-emerald-600 text-white"
                : "bg-foreground text-background hover:opacity-90"
            }`}
          >
            <span className={`inline-block h-1.5 w-1.5 rounded-full ${activeRunId ? "bg-white animate-ping" : "bg-emerald-400"}`} />
            {isStarting ? "Starting..." : activeRunId ? "Scraper Active" : "Run Scraper"}
          </button>
          <span className="label-mono shrink-0 text-muted-foreground">
            <span className="text-foreground font-mono font-bold">{totalScraped}</span> scraped
          </span>
          <span className="hidden md:inline-block text-border/60">|</span>
          <span className="label-mono hidden shrink-0 md:inline text-muted-foreground">
            LinkedIn <span className="text-foreground font-mono font-bold">{baseCounts.bySource.LinkedIn}</span>
          </span>
          <span className="label-mono hidden shrink-0 md:inline text-muted-foreground">
            Naukri <span className="text-foreground font-mono font-bold">{baseCounts.bySource.Naukri}</span>
          </span>
          <span className="label-mono hidden shrink-0 md:inline text-muted-foreground">
            Indeed <span className="text-foreground font-mono font-bold">{baseCounts.bySource.Indeed}</span>
          </span>
          <span className="label-mono shrink-0 text-emerald-600 dark:text-emerald-400 font-bold">
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

function ShortlistCardRow({
  o,
  idx,
  isOpen,
  openedTimes,
  setOpenedTimes,
  setOpen,
  decide,
  showArrivalBanner,
}: {
  o: Opportunity;
  idx: number;
  isOpen: boolean;
  openedTimes: Record<string, number>;
  setOpenedTimes: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setOpen: React.Dispatch<React.SetStateAction<string | null>>;
  decide: (jobHash: string, verb: DecisionVerb) => void;
  showArrivalBanner: boolean;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const brief = BriefCompositionEngine.compose(o, { bypassHistory: true });
  const score = o.recommendationResult?.score ?? 80;

  useEffect(() => {
    if (isOpen && rowRef.current) {
      const timer = setTimeout(() => {
        rowRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
      }, 60);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const badgeClass = 
    o.decision === "CONSIDER" 
      ? "badge-consider" 
      : o.decision === "PASS" 
        ? "badge-pass" 
        : "badge-pursue";

  const scoreClass = 
    score >= 75 
      ? "score-badge-high" 
      : score >= 60 
        ? "score-badge-mid" 
        : "score-badge-low";

  return (
    <li
      ref={rowRef}
      className={`scroll-mt-24 glass-card rounded-xl border border-border/60 transition-all duration-200 card-lift overflow-hidden ${
        showArrivalBanner && idx === 0 ? "border-l-4 border-l-emerald-500 bg-emerald-500/5" : ""
      }`}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        onClick={() => {
          if (isOpen) {
            const openTime = openedTimes[o.jobHash];
            const duration = openTime ? Date.now() - openTime : 0;
            logTelemetry(o.jobHash, "CLOSE", duration);
            setOpenedTimes((prev) => {
              const next = { ...prev };
              delete next[o.jobHash];
              return next;
            });
            setOpen(null);
          } else {
            setOpenedTimes((prev) => ({ ...prev, [o.jobHash]: Date.now() }));
            logTelemetry(o.jobHash, "EXPAND", 0);
            setOpen(o.jobHash);
          }
        }}
        className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-4 p-4 text-left transition-colors sm:p-5 cursor-pointer"
      >
        <span className="min-w-0">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
            <span className="label-mono tabular-nums text-muted-foreground font-semibold">
              {(idx + 1).toString().padStart(2, "0")}
            </span>
            <span className="font-display text-2xl leading-tight sm:text-[1.7rem] text-foreground font-normal group-hover:text-primary transition-colors">
              {o.role}
            </span>
            <span className={`label-mono shrink-0 rounded-full px-2.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-wider ${badgeClass}`}>
              {o.decision?.toLowerCase() || "pursue"}
            </span>
            <span className="label-mono hidden rounded-full bg-muted/80 px-2.5 py-0.5 text-[0.62rem] text-muted-foreground sm:inline font-medium">
              {o.mandateArchetype && o.mandateArchetype !== "Growth Marketing" ? o.mandateArchetype : inferExecutiveMandateArchetype(o.role, (o as any).rawText || (o as any).description)}
            </span>
          </span>

          <span className="label-mono mt-2 block truncate text-muted-foreground font-medium text-[0.72rem]">
            {o.company} · {o.location} ({(o as any).workModel || "On-site"}) · {o.scrapedFrom}
          </span>

          <span className="mt-2 block max-w-2xl font-display text-base italic leading-snug text-muted-foreground font-normal">
            {brief.memory.retentionSentence || o.whyNow}
          </span>

          {(brief.frictionPreview || brief.topUnknownPreview) && (
            <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[0.68rem] text-amber-700 dark:text-amber-300 border border-amber-500/20 font-mono">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              Needs verification: {brief.frictionPreview || brief.topUnknownPreview}
            </span>
          )}
        </span>

        <span className="flex shrink-0 flex-col items-end gap-2">
          <span className={`flex shrink-0 items-center justify-center h-10 w-10 rounded-full border-2 font-display text-lg font-bold shadow-xs ${scoreClass}`}>
            {score}
          </span>
          <span className="label-mono text-[0.68rem] text-muted-foreground group-hover:text-foreground font-semibold transition-colors">
            {isOpen ? "— Close" : "+ Brief"}
          </span>
        </span>
      </button>

      {/* Expanded Brief Drawer with smooth CSS grid expansion */}
      <div
        className={`grid transition-all duration-300 ease-out overflow-hidden ${
          isOpen ? "grid-rows-[1fr] opacity-100 p-4 border-t border-border/60 bg-muted/20" : "grid-rows-[0fr] opacity-0 p-0"
        }`}
      >
        <div className="min-h-0">
          {isOpen && (
            <InlineBrief opportunity={o} onDecide={(verb) => decide(o.jobHash, verb)} />
          )}
        </div>
      </div>
    </li>
  );
}
