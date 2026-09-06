import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { type DecisionVerb, type EvaluatedOpportunity, type ServedOpportunity, isEvaluated, isUnavailable, isUnmaterialized } from "../data/opportunity-fixtures";
import { InlineBrief } from "../components/radar/InlineBrief";
import { useDecisions } from "../lib/decisions-store";
import { getOpportunitiesFn, getOpportunityDetailsFn, getShortlistMetricsFn } from "../lib/intelligence/opportunity-server";
import { triggerScrapeFn, getLiveScrapedFn, confirmScrapeFn, abortScrapeFn, getScrapePlanPreviewFn } from "../lib/intelligence/scrape-server";
import { ScraperConsole } from "../components/radar/ScraperConsole";
import { logTelemetry } from "../lib/telemetry";
import { useOnboarding } from "../components/onboarding/OnboardingProvider";

import { useScrapeProgress } from "../components/radar/ScrapeProgressProvider";
import { useAttentionPreference } from "../lib/attention-store";
import { hasMatchingEvaluationFingerprint } from "../lib/intelligence/dossier/cache-identity";
import {
  CANONICAL_CATEGORIES,
  type CategoryId,
} from "../lib/domain/category_taxonomy";

export function getTimeAwareGreeting(userName?: string): string {
  const namePart = userName ? `, ${userName}` : "";
  if (typeof window === "undefined") {
    return `Good morning${namePart}!`;
  }
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) {
    return `Good morning${namePart}!`;
  }
  if (hour >= 12 && hour < 17) {
    return `Good afternoon${namePart}!`;
  }
  return `Good evening${namePart}!`;
}

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
  staleTime: 0,
  loader: async () => {
    const [opportunitiesList, metrics, searchPlanPreview] = await Promise.all([
      getOpportunitiesFn(),
      getShortlistMetricsFn(),
      getScrapePlanPreviewFn(),
    ]);
    return {
      opportunitiesList,
      metrics,
      searchPlanPreview,
    };
  },
  component: Shortlist,
});

export function dossierCacheKey(opportunity: EvaluatedOpportunity): string {
  return `${opportunity.jobHash}:${opportunity.engineRecommendation?.evaluationFingerprint ?? "unknown"}`;
}

export function isCurrentDossierResponse(
  requested: EvaluatedOpportunity,
  response: ServedOpportunity | null | undefined,
): response is EvaluatedOpportunity {
  return Boolean(response && isEvaluated(response) && hasMatchingEvaluationFingerprint(
    requested.engineRecommendation?.evaluationFingerprint,
    response.engineRecommendation?.evaluationFingerprint,
  ));
}

function Shortlist() {
  const { opportunitiesList, metrics, searchPlanPreview } = Route.useLoaderData();
  const { decide: recordDecision } = useDecisions();
  const { progress, markArrivalSeen } = useOnboarding();
  const [open, setOpen] = useState<string | null>(null);
  const [openedTimes, setOpenedTimes] = useState<Record<string, number>>({});
  const [selectedCategoryId, setSelectedCategoryId] = useState<CategoryId>("all");
  const [categoryOps, setCategoryOps] = useState<ServedOpportunity[] | null>(null);
  const [dossierByJobHash, setDossierByJobHash] = useState<Record<string, ServedOpportunity | null | undefined>>({});
  const [isLoadingCategory, setIsLoadingCategory] = useState(false);
  const categoryCacheRef = useRef<Map<string, ServedOpportunity[]>>(new Map());

  useEffect(() => {
    categoryCacheRef.current.clear();
  }, [opportunitiesList]);

  useEffect(() => {
    if (selectedCategoryId === "all") {
      setCategoryOps(null);
      setIsLoadingCategory(false);
      return;
    }

    if (categoryCacheRef.current.has(selectedCategoryId)) {
      setCategoryOps(categoryCacheRef.current.get(selectedCategoryId)!);
      setIsLoadingCategory(false);
      return;
    }

    let active = true;
    setIsLoadingCategory(true);
    getOpportunitiesFn({ data: { categoryId: selectedCategoryId } })
      .then((ops) => {
        if (active) {
          categoryCacheRef.current.set(selectedCategoryId, ops);
          setCategoryOps(ops);
          setIsLoadingCategory(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load category opportunities:", err);
        if (active) setIsLoadingCategory(false);
      });

    return () => {
      active = false;
    };
  }, [selectedCategoryId]);

  const activeOps = categoryOps ?? opportunitiesList;

  const loadDossier = (opportunity: EvaluatedOpportunity) => {
    const cacheKey = dossierCacheKey(opportunity);
    if (dossierByJobHash[cacheKey] !== undefined) return;
    setDossierByJobHash((current) => ({ ...current, [cacheKey]: null }));
    getOpportunityDetailsFn({ data: opportunity.jobHash })
      .then((details) => setDossierByJobHash((current) => {
        if (!isCurrentDossierResponse(opportunity, details.opportunity)) {
          const { [cacheKey]: _discarded, ...withoutMismatchedResponse } = current;
          return withoutMismatchedResponse;
        }
        return { ...current, [cacheKey]: details.opportunity };
      }))
      .catch(() => setDossierByJobHash((current) => ({ ...current, [cacheKey]: null })));
  };

  const showArrivalBanner = !progress.arrivalSeen;
  const isBothSkipped = progress.evidenceStatus === "skipped" && progress.intentStatus === "skipped";

  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [extraScraped, setExtraScraped] = useState(0);
  const router = useRouter();

  const sourceCounts = useMemo(() => {
    const counts = { LinkedIn: 0, Naukri: 0, Indeed: 0 };
    for (const o of activeOps) {
      const src = o.scrapedFrom as keyof typeof counts;
      if (counts[src] !== undefined) {
        counts[src]++;
      }
    }
    return counts;
  }, [activeOps]);

  const totalShortlisted = metrics?.totalShortlisted ?? 0;
  const totalDecisionsCount = metrics?.totalDecisions ?? 0;
  const totalScreenedCount = (metrics?.totalScreened ?? 0) + extraScraped;
  const integrity = metrics?.integrity;

  const { attentionWindow } = useAttentionPreference();
  const [cursorIndex, setCursorIndex] = useState(0);
  const [greeting, setGreeting] = useState("Good morning, Swapnil!");

  useEffect(() => {
    setGreeting(getTimeAwareGreeting("Swapnil"));
  }, []);

  // `activeOps` is the canonical server-selected review queue. The browser only
  // paginates its presentation; it never reinterprets verdicts or review state.
  const visible = useMemo(() => {
    return activeOps.slice(cursorIndex, cursorIndex + attentionWindow);
  }, [activeOps, cursorIndex, attentionWindow]);

  const hasNext = cursorIndex + attentionWindow < activeOps.length;
  const hasPrev = cursorIndex > 0;

  const handleNext = () => {
    if (hasNext) {
      setCursorIndex((prev) => prev + attentionWindow);
    }
  };

  const handlePrev = () => {
    if (hasPrev) {
      setCursorIndex((prev) => Math.max(0, prev - attentionWindow));
    }
  };

  const decide = (jobHash: string, verb: DecisionVerb, reviewedFingerprint?: string | null) => {
    // UNKNOWN is presentation of absent evaluation, never an action to persist.
    if (verb === "UNKNOWN") return;
    const openTime = openedTimes[jobHash];
    const duration = openTime ? Date.now() - openTime : 0;
    logTelemetry(jobHash, verb, duration);

    recordDecision(jobHash, verb, reviewedFingerprint);
    void router.invalidate();
    setOpen((cur) => (cur === jobHash ? null : cur));

    setOpenedTimes((prev) => {
      const next = { ...prev };
      delete next[jobHash];
      return next;
    });
  };

  const { runState, startScrape, isStarting, restore } = useScrapeProgress();
  const totalScraped = totalScreenedCount;

  return (
    <div className="min-h-screen pb-28 bg-background text-foreground font-sans">
      <main className="mx-auto max-w-[1180px] px-5 sm:px-8 pt-4">
        {/* Metric Integrity Warning Banner */}
        {integrity && integrity.status !== "PASS" && (
          <div className="mb-4 p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200 text-xs font-mono flex items-start gap-3">
            <span className="text-base leading-none">⚠️</span>
            <div className="flex-1">
              <p className="font-bold uppercase tracking-wider text-[11px]">Metric Integrity Check Requires Attention</p>
              <p className="mt-1 text-muted-foreground">
                Some dashboard counts may be temporarily inconsistent with underlying evaluation data. RADAR is validating evaluation state.
              </p>
              {process.env.NODE_ENV !== "production" && integrity.discrepancies.length > 0 && (
                <div className="mt-2 pt-2 border-t border-amber-500/20 space-y-1 text-[10px]">
                  {integrity.discrepancies.map((d, i) => (
                    <div key={i}>
                      • <span className="font-semibold">{d.metricName}</span>: expected {String(d.expected)}, got {String(d.actual)} ({d.message})
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

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
            <h1 className="mt-2 font-display text-[3.25rem] leading-[0.92] tracking-tight sm:text-6xl text-foreground font-normal" suppressHydrationWarning>
              {greeting}
            </h1>
            <p className="mt-3 max-w-lg text-lg leading-relaxed text-foreground font-medium">
              Here are your top opportunities.
            </p>
          </div>

          <dl className="flex items-center gap-6 overflow-x-auto sm:gap-8">
            <div className="border-r border-border/40 pr-6 sm:pr-8">
              <dd className="font-display text-4xl sm:text-5xl text-emerald-600 dark:text-emerald-400 tabular-nums font-normal">
                {String(totalShortlisted).padStart(2, "0")}
              </dd>
              <dt className="label-mono mt-1 text-[0.68rem] text-emerald-700 dark:text-emerald-300 font-semibold uppercase tracking-wider">Shortlisted</dt>
            </div>

            <div className="border-r border-border/40 pr-6 sm:pr-8">
              <dd className="font-display text-4xl sm:text-5xl text-foreground tabular-nums font-normal">
                {totalDecisionsCount}
              </dd>
              <dt className="label-mono mt-1 text-[0.68rem] text-muted-foreground font-semibold uppercase tracking-wider">Decisions</dt>
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
          <div className="space-y-3 pb-4 border-b border-border/60 mb-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="label-mono text-foreground font-semibold tracking-wider text-xs sm:text-sm uppercase">
                {selectedCategoryId === "all"
                  ? `Sorted by Fit · ${totalShortlisted} Shortlisted`
                  : `Sorted by Fit · ${
                      selectedCategoryId === "needs_more_signal"
                        ? metrics?.categoryMetrics?.[selectedCategoryId]?.unreviewed ?? (isLoadingCategory ? "..." : activeOps.length)
                        : metrics?.categoryMetrics?.[selectedCategoryId]?.shortlisted ?? (isLoadingCategory ? "..." : activeOps.length)
                    } ${CANONICAL_CATEGORIES.find((c) => c.id === selectedCategoryId)?.label || selectedCategoryId}`}
              </h2>
              {selectedCategoryId === "all" && (
                <span className="label-mono text-[11px] text-muted-foreground">
                  {metrics?.discoveryMetrics?.actionableReviewQueue !== undefined
                    ? `${metrics.discoveryMetrics.actionableReviewQueue} remaining to review`
                    : `${activeOps.length} on page`}
                </span>
              )}
            </div>

            {/* Human-Friendly Category Filters */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              {CANONICAL_CATEGORIES.map((catDef) => {
                const isSelected = selectedCategoryId === catDef.id;
                const catMetric = metrics?.categoryMetrics?.[catDef.id];

                let countLabel = "";
                if (catDef.id === "all") {
                  const cnt = catMetric?.shortlisted ?? activeOps.length;
                  countLabel = ` (${cnt})`;
                } else if (catDef.id === "needs_more_signal") {
                  // Sparse-signal membership is state-derived and is not an
                  // evaluated shortlist count.
                  const unrev = catMetric?.unreviewed ?? activeOps.length;
                  const tot = catMetric?.total ?? activeOps.length;
                  countLabel = ` (${unrev} / ${tot})`;
                } else {
                  const unrev = catMetric?.shortlisted ?? (selectedCategoryId === catDef.id ? activeOps.length : 0);
                  countLabel = ` (${unrev})`;
                }

                const displayLabel = `${catDef.label}${countLabel}`;

                return (
                  <button
                    key={catDef.id}
                    type="button"
                    onClick={() => setSelectedCategoryId(catDef.id)}
                    className={`inline-flex items-center text-[0.65rem] font-mono uppercase tracking-wider px-3 py-1 rounded-full border transition-all cursor-pointer ${
                      isSelected
                        ? "bg-foreground text-background border-foreground font-semibold shadow-xs"
                        : catDef.id === "needs_more_signal"
                          ? "text-amber-700 dark:text-amber-300 bg-amber-500/10 border-amber-500/30 hover:bg-amber-500/20 font-semibold"
                          : "text-muted-foreground bg-surface-raised/40 border-border/60 hover:text-foreground hover:bg-muted/80 hover:border-border"
                    }`}
                  >
                    {isLoadingCategory && isSelected && (
                      <span className="relative flex h-1.5 w-1.5 mr-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary-foreground opacity-75" />
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary-foreground" />
                      </span>
                    )}
                    {displayLabel}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-3 min-h-[300px]">
            {isLoadingCategory ? (
              <ShortlistSkeletonQueue
                categoryLabel={CANONICAL_CATEGORIES.find((c) => c.id === selectedCategoryId)?.label || selectedCategoryId}
              />
            ) : (
              <ul className="space-y-3">
                {visible.map((o, idx) => {
                  const isOpen = open === o.jobHash;

                  return isEvaluated(o) ? (
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
                      dossier={dossierByJobHash[dossierCacheKey(o)]}
                      onExpand={loadDossier}
                    />
                  ) : (
                    <MinimalStateCard key={o.jobHash} o={o} />
                  );
                })}

                {visible.length === 0 && (
                  <li className="glass-card rounded-xl py-16 text-center font-display text-xl text-muted-foreground list-none">
                    {selectedCategoryId === "all" 
                      ? (totalShortlisted > 0 && activeOps.length === 0
                          ? `All ${totalShortlisted} shortlist opportunities have recorded decisions.`
                          : "No shortlist opportunities remaining to review.")
                      : selectedCategoryId === "needs_more_signal"
                        ? "No opportunities need more signal."
                        : `No unreviewed opportunities match "${CANONICAL_CATEGORIES.find((c) => c.id === selectedCategoryId)?.label || selectedCategoryId}".`}
                  </li>
                )}
              </ul>
            )}

            {/* Guided Attention Navigation & Escape Hatch Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-border/60">
              <div className="flex items-center gap-2">
                {hasPrev && (
                  <button
                    type="button"
                    onClick={handlePrev}
                    className="inline-flex items-center gap-1 text-[11px] font-mono font-bold uppercase tracking-wider px-4 py-2 rounded-xs border border-border bg-surface-raised hover:bg-muted transition-colors cursor-pointer"
                    data-testid="guided-prev-btn"
                  >
                    ← Previous
                  </button>
                )}
                {hasNext && (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="inline-flex items-center gap-1 text-[11px] font-mono font-bold uppercase tracking-wider px-4 py-2 rounded-xs border border-foreground bg-foreground text-background hover:opacity-90 transition-opacity cursor-pointer"
                    data-testid="guided-next-btn"
                  >
                    Next →
                  </button>
                )}
              </div>

              {/* Escape hatch: Introduce "Other matched opportunities →" after guided sequence begins extending beyond initial presentation window */}
              {(cursorIndex > 0 || activeOps.length > attentionWindow) && (
                <Link
                  to="/decisions"
                  className="inline-flex items-center text-[11.5px] font-mono text-muted-foreground hover:text-foreground transition-colors"
                  data-testid="escape-hatch-link"
                >
                  Other matched opportunities ({activeOps.length}) →
                </Link>
              )}
            </div>
          </div>
        </section>

        <details className="memo-card mb-space-6" data-testid="active-search-plan">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-space-3">
            <span>
              <span className="label-mono text-muted-foreground">Active search execution</span>
              <span className="mt-1 block font-serif text-xl text-foreground">View the exact next-search plan</span>
            </span>
            {searchPlanPreview.status === "ready" ? (
              <span className="memo-badge bg-signal text-signal-foreground">
                {searchPlanPreview.postedWithinDays ? `${searchPlanPreview.postedWithinDays} days` : "No date limit"}
                {searchPlanPreview.location ? ` · ${searchPlanPreview.location}` : ""}
              </span>
            ) : (
              <span className="memo-badge bg-caution text-caution-foreground">Unavailable</span>
            )}
          </summary>

          {searchPlanPreview.status === "ready" ? (
            <>
              <dl className="mt-space-3 grid gap-space-2 border-t border-border pt-space-3 sm:grid-cols-4">
                <div>
                  <dt className="label-mono text-muted-foreground">Freshness</dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">
                    {searchPlanPreview.postedWithinDays ? `Last ${searchPlanPreview.postedWithinDays} days` : "No date limiter"}
                  </dd>
                </div>
                <div>
                  <dt className="label-mono text-muted-foreground">Location</dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">{searchPlanPreview.location || "No location limiter"}</dd>
                </div>
                <div>
                  <dt className="label-mono text-muted-foreground">Ordering</dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">{searchPlanPreview.sort === "date" ? "Most recent first" : "Portal relevance"}</dd>
                </div>
                <div>
                  <dt className="label-mono text-muted-foreground">Portals</dt>
                  <dd className="mt-1 text-sm font-medium text-foreground">{searchPlanPreview.portals.join(" · ")}</dd>
                </div>
              </dl>

              <div className="mt-space-3 border-t border-border pt-space-3">
                <p className="label-mono text-muted-foreground">
                  {searchPlanPreview.keywords.length} compiled keywords · {searchPlanPreview.executionSurfaceCount} initial portal surfaces
                </p>
                <ul className="mt-space-2 grid max-h-40 grid-cols-1 gap-space-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3" aria-label="Compiled search keywords">
                  {searchPlanPreview.keywords.map((keyword) => (
                    <li key={keyword} className="text-sm text-foreground">{keyword}</li>
                  ))}
                </ul>
              </div>
            </>
          ) : (
            <p className="mt-space-3 border-t border-border pt-space-3 text-sm text-caution">
              Active plan unavailable: {searchPlanPreview.error}
            </p>
          )}
        </details>
      </main>

      {/* ────────────────────────────────────────────────────────────────────────
          FLOATING FOOTER STATUS BAR
          ──────────────────────────────────────────────────────────────────────── */}
      <div className="floating-dock gap-4 pointer-events-auto">
        <button
          type="button"
          onClick={() => {
            if (runState?.isActive) {
              restore();
            } else {
              void startScrape();
            }
          }}
          disabled={isStarting}
          className={`dock-btn transition-all shadow-xs ${
            runState?.isActive
              ? "bg-emerald-600 text-white"
              : "bg-foreground text-background hover:opacity-90"
          }`}
        >
          <span className={`inline-block h-1.5 w-1.5 rounded-full ${runState?.isActive ? "bg-white animate-ping" : "bg-emerald-400"}`} />
          {isStarting ? "Starting..." : runState?.isActive ? "Search Active" : "Run Search"}
        </button>
        <span className="dock-text">
          <strong>{(metrics?.portalMetrics?.total ?? totalScraped).toLocaleString()}</strong> candidates
        </span>
        <span className="hidden md:inline-block text-border/40">|</span>
        <span className="dock-text hidden md:inline">
          LinkedIn <strong>{(metrics?.portalMetrics?.LinkedIn ?? sourceCounts.LinkedIn).toLocaleString()}</strong>
        </span>
        <span className="dock-text hidden md:inline">
          Naukri <strong>{(metrics?.portalMetrics?.Naukri ?? sourceCounts.Naukri).toLocaleString()}</strong>
        </span>
        <span className="dock-text hidden md:inline">
          Indeed <strong>{(metrics?.portalMetrics?.Indeed ?? sourceCounts.Indeed).toLocaleString()}</strong>
        </span>
        <span className="dock-text text-emerald-600 dark:text-emerald-400 font-bold">
          → {selectedCategoryId === "all" ? (metrics?.discoveryMetrics?.actionableReviewQueue ?? activeOps.length) : (metrics?.categoryMetrics?.[selectedCategoryId]?.shortlisted ?? activeOps.length)} of {selectedCategoryId === "all" ? totalShortlisted : (metrics?.categoryMetrics?.[selectedCategoryId]?.shortlisted ?? activeOps.length)} to review
        </span>
      </div>
    </div>
  );
}

export function resolveShortlistCardScore(
  o: EvaluatedOpportunity,
): { rawScore: number | null | undefined; scoreDisplay: string | number } {
  const rawScore = o.engineRecommendation?.qualityScore;
  const scoreDisplay = rawScore === null || rawScore === undefined ? "—" : rawScore;
  return { rawScore, scoreDisplay };
}

export interface ShortlistCardBadgeState {
  primaryLabel: string;
  badgeClass: string;
  isStale: boolean;
  staleLabel: "Re-evaluated" | "Review again" | null;
  previousAction: string | null;
}

export function resolveShortlistCardBadgeState(o: EvaluatedOpportunity): ShortlistCardBadgeState {
  if ((o as any).evaluationState === "SPARSE_SPEC" || o.engineRecommendation?.engineVerdict === "SPARSE_SPEC") {
    return {
      primaryLabel: "needs more signal",
      badgeClass: "badge-sparse text-amber-600 bg-amber-500/10 border border-amber-500/20",
      isStale: false,
      staleLabel: null,
      previousAction: null,
    };
  }

  if ((o as any).evaluationState === "INVALID" || (o as any).evaluationState === "NOT_EVALUABLE" || (o as any).evaluationState === "PROFILE_REQUIRED" || (o as any).evaluationState === "UNMATERIALIZED") {
    return {
      primaryLabel: (o as any).evaluationState === "INVALID" ? "evaluation invalid" : "not evaluated",
      badgeClass: "badge-sparse text-amber-600 bg-amber-500/10 border border-amber-500/20",
      isStale: false,
      staleLabel: null,
      previousAction: null,
    };
  }

  const engineVerdict = o.engineRecommendation?.engineVerdict || o.decision || "UNKNOWN";
  
  const primaryLabel = engineVerdict.toLowerCase();
  
  const badgeClass = 
    engineVerdict === "CONSIDER" 
        ? "badge-consider" 
        : engineVerdict === "PASS" 
          ? "badge-pass" 
        : engineVerdict === "PURSUE" ? "badge-pursue" : "badge-sparse";
          
  const isStale = o.reviewWorkflowState === "REVIEWED_STALE" || o.reviewWorkflowState === "REVIEWED_UNKNOWN";
  
  const staleLabel = 
    !isStale 
      ? null 
      : o.reviewWorkflowState === "REVIEWED_STALE" 
        ? "Re-evaluated" 
        : "Review again";
        
  const previousAction = 
    isStale && o.userDecision?.userAction && o.userDecision.userAction !== "NONE"
      ? o.userDecision.userAction
      : null;
      
  return {
    primaryLabel,
    badgeClass,
    isStale,
    staleLabel,
    previousAction,
  };
}


function MinimalStateCard({ o }: { o: ServedOpportunity }) {
  let label = "Unavailable";
  let badgeClass = "bg-muted text-muted-foreground border-border";
  
  if (isUnmaterialized(o)) {
    label = "Evaluation Pending";
    badgeClass = "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20";
  } else if (isUnavailable(o)) {
    switch (o.evaluationState) {
      case "ACQUISITION_PENDING":
        label = "Fetching Details";
        badgeClass = "bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20";
        break;
      case "ACQUISITION_FAILED":
      case "NOT_EVALUABLE":
      case "PROFILE_REQUIRED":
        label = "Cannot Evaluate";
        badgeClass = "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20";
        break;
      case "INVALID":
        label = "Evaluation Invalid";
        badgeClass = "bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/20";
        break;
      case "EXPIRED":
        label = "Expired";
        badgeClass = "bg-muted text-muted-foreground border-border";
        break;
      default:
        label = o.evaluationState;
        break;
    }
  }

  return (
    <li className="group relative block w-full text-left transition-all bg-surface-raised border border-border/40 shadow-xs rounded-xl p-4 flex items-center justify-between opacity-80 grayscale-[30%]">
      <span className="flex min-w-0 flex-1 flex-col gap-1.5 pl-3 border-l-2 border-border/30">
        <span className="flex items-center gap-2">
          <span className="font-display text-lg text-foreground font-normal">
            {o.role}
          </span>
          <span className={`label-mono shrink-0 rounded-full px-2.5 py-0.5 text-[0.62rem] font-bold uppercase tracking-wider ${badgeClass}`}>
            {label}
          </span>
        </span>
        <span className="label-mono block truncate text-muted-foreground font-medium text-[0.72rem]">
          {o.company} · {o.location} · {o.scrapedFrom}
        </span>
      </span>
    </li>
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
  dossier,
  onExpand,
}: {
  o: EvaluatedOpportunity;
  idx: number;
  isOpen: boolean;
  openedTimes: Record<string, number>;
  setOpenedTimes: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  setOpen: React.Dispatch<React.SetStateAction<string | null>>;
  decide: (jobHash: string, verb: DecisionVerb, reviewedFingerprint?: string | null) => void;
  showArrivalBanner: boolean;
  dossier: ServedOpportunity | null | undefined;
  onExpand: (opportunity: EvaluatedOpportunity) => void;
}) {
  const rowRef = useRef<HTMLLIElement>(null);
  const { rawScore, scoreDisplay } = resolveShortlistCardScore(o);
  const { primaryLabel, badgeClass, isStale, staleLabel, previousAction } = resolveShortlistCardBadgeState(o);
  const evaluatedDossier = dossier && isEvaluated(dossier) ? dossier : undefined;
  const dossierBrief = evaluatedDossier?.dossierPresentation?.brief as {
    memory?: { retentionSentence?: string };
    frictionPreview?: string;
    topUnknownPreview?: string;
  } | undefined;

  useEffect(() => {
    if (isOpen && rowRef.current) {
      const isMobile = window.innerWidth < 768;
      const timer = setTimeout(() => {
        rowRef.current?.scrollIntoView({
          behavior: "smooth",
          block: isMobile ? "start" : "nearest",
        });
      }, 70);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  const scoreClass = 
    (typeof rawScore === "number" && rawScore >= 75)
      ? "score-badge-high" 
      : (typeof rawScore === "number" && rawScore >= 60)
        ? "score-badge-mid" 
        : "score-badge-low";

  return (
    <li
      ref={rowRef}
      className={`scroll-mt-20 sm:scroll-mt-24 glass-card rounded-xl border transition-all duration-300 overflow-hidden ${
        isOpen
          ? "border-primary/50 shadow-md ring-1 ring-primary/20 bg-surface-raised"
          : "border-border/60 hover:border-border card-lift"
      } ${
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
            onExpand(o);
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
              {primaryLabel}
            </span>
            {isStale && staleLabel && (
              <span className="label-mono shrink-0 rounded-full bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 text-[0.58rem] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                {staleLabel}
              </span>
            )}
            {previousAction && (
              <span className="label-mono shrink-0 rounded-full bg-muted/60 border border-border px-2.5 py-0.5 text-[0.58rem] font-medium text-muted-foreground uppercase tracking-wider">
                Previously {previousAction}
              </span>
            )}
            {o.mandateArchetype && <span className="label-mono hidden rounded-full bg-muted/80 px-2.5 py-0.5 text-[0.62rem] text-muted-foreground sm:inline font-medium">{o.mandateArchetype}</span>}
          </span>

          <span className="label-mono mt-2 block truncate text-muted-foreground font-medium text-[0.72rem]">
            {o.company} · {o.location}{(o as { workModel?: string }).workModel ? ` (${(o as { workModel?: string }).workModel})` : ""} · {o.scrapedFrom}
          </span>

          {dossierBrief?.memory?.retentionSentence && <span className="mt-2 block max-w-2xl font-display text-base italic leading-snug text-muted-foreground font-normal">
            {dossierBrief.memory.retentionSentence}
          </span>}

          {(dossierBrief?.frictionPreview || dossierBrief?.topUnknownPreview) && (
            <span className="mt-2.5 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-[0.68rem] text-amber-700 dark:text-amber-300 border border-amber-500/20 font-mono">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              Needs verification: {dossierBrief?.frictionPreview || dossierBrief?.topUnknownPreview}
            </span>
          )}
        </span>

        <span className="flex shrink-0 flex-col items-end gap-2">
          <span className={`flex shrink-0 items-center justify-center h-10 w-10 rounded-full border-2 font-display text-lg font-bold shadow-xs ${scoreClass}`}>
            {scoreDisplay}
          </span>
          <span className="label-mono text-[0.68rem] text-muted-foreground group-hover:text-foreground font-semibold transition-colors">
            {isOpen ? "— Close" : "+ Brief"}
          </span>
        </span>
      </button>

      {/* Expanded Brief Drawer with smooth CSS grid expansion */}
      <div
        className={`grid transition-all duration-300 ease-out overflow-hidden ${
          isOpen ? "grid-rows-[1fr] opacity-100 p-3 sm:p-4 border-t border-border/60 bg-muted/20 dark:bg-muted/10" : "grid-rows-[0fr] opacity-0 p-0"
        }`}
      >
        <div className="min-h-0">
          {isOpen && (
            <InlineBrief
              opportunity={o}
              dossier={evaluatedDossier}
              onDecide={(verb) =>
                decide(
                  o.jobHash,
                  verb,
                  o.engineRecommendation?.evaluationFingerprint
                )
              }
            />
          )}
        </div>
      </div>
    </li>
  );
}

function ShortlistSkeletonQueue({ categoryLabel }: { categoryLabel: string }) {
  return (
    <div className="space-y-3 animate-reveal">
      {/* Precision Scan Bar Landmark */}
      <div className="glass-card rounded-lg px-4 py-2.5 border border-border/60 flex items-center justify-between">
        <span className="label-mono text-[0.68rem] text-muted-foreground flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary animate-ping" />
          CALIBRATING {categoryLabel.toUpperCase()} DOSSIERS...
        </span>
        <span className="label-mono text-[0.65rem] text-muted-foreground/80 hidden sm:inline">
          EVALUATING MANDATE EVIDENCE
        </span>
      </div>

      <div className="relative overflow-hidden h-[1.5px] w-full bg-border/40 rounded-full mb-3">
        <div className="absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan-line" />
      </div>

      {[1, 2, 3].map((idx) => (
        <div
          key={idx}
          className="glass-card rounded-xl border border-border/50 p-4 sm:p-5 overflow-hidden transition-opacity duration-300"
          style={{ opacity: 1 - idx * 0.25 }}
        >
          <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
            <div className="min-w-0 space-y-2.5">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="h-3 w-5 rounded-sm bg-muted/80 animate-pulse" />
                <div className="h-6 w-48 sm:w-72 rounded-md bg-muted/90 animate-shimmer" />
                <div className="h-4 w-16 rounded-full bg-muted/60" />
                <div className="h-4 w-28 rounded-full bg-muted/40 hidden sm:block" />
              </div>

              <div className="h-3 w-48 rounded bg-muted/60 animate-pulse" />
              <div className="h-4 w-full max-w-lg rounded bg-muted/40" />
            </div>

            <div className="flex shrink-0 flex-col items-end gap-2">
              <div className="h-10 w-10 rounded-full bg-muted/80 border border-border/60 animate-pulse" />
              <div className="h-2.5 w-10 rounded bg-muted/40" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
