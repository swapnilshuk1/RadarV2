import { type ServedOpportunity, isEvaluated, isUnavailable, type EvaluatedOpportunity } from "../data/opportunity-fixtures";
import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { applicationActionFor, type DecisionVerb, type Opportunity } from "../data/opportunity-fixtures";
import { useDecisions, type DecisionRecord } from "../lib/decisions-store";
import { DecisionBadge } from "../components/radar/DecisionBadge";
import { getDecidedOpportunitiesFn } from "../lib/intelligence/opportunity-server";
import { ClientOpportunityCache } from "../lib/opportunity-cache";


export const Route = createFileRoute("/decisions")({
  head: () => ({
    meta: [
      { title: "Your opportunities — RADAR" },
      { name: "description", content: "Your active executive pipeline: search, filter, revisit and control opportunities across your pipeline." },
      { name: "robots", content: "noindex" },
    ],
  }),
  staleTime: 0,
  loader: async () => {
    return {
      opportunitiesList: await getDecidedOpportunitiesFn()
    };
  },
  component: OpportunitiesPage,
});

interface TrackingData {
  latestConversation: string;
  nextAction: string;
  followUpDate: string;
}

type TrackingMap = Record<string, TrackingData>;

const TRACK_KEY = "radar.opportunities.tracking.v1";

function readTracking(): TrackingMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TRACK_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeTracking(next: TrackingMap) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TRACK_KEY, JSON.stringify(next));
  } catch {}
}

export function resolveDecisionsCardScore(
  o: Opportunity,
  brief?: { qualityScore?: number | null }
): string {
  const score = brief?.qualityScore ?? o.engineRecommendation?.qualityScore ?? o.recommendationResult?.score;
  if (score !== null && score !== undefined) {
    return `Fit Index ${score}%`;
  }
  if (o.engineRecommendation?.vetoed) {
    return `Vetoed (${o.engineRecommendation.vetoReason || "Mismatch"})`;
  }
  return o.engineRecommendation?.engineVerdict || "Unscored";
}

export type FilterKey = "ALL" | "PURSUE" | "CONSIDER" | "PASS" | "UNREVIEWED";

function OpportunitiesPage() {
  const { decisions, undo, clear, hydrated } = useDecisions();
  const { opportunitiesList: loadedOpportunities } = Route.useLoaderData();
  const rawOpportunities = loadedOpportunities as Array<Opportunity | ServedOpportunity>;
  // Phase 4: Non-evaluated variants without decisions must not contribute to counts or enter the ledger.
  // Explicit user decisions (including those on sparse specifications) remain preserved and represented.
  const opportunitiesList = useMemo(
    () => rawOpportunities.filter((o) => isEvaluated(o) || Boolean(decisions[o.jobHash]?.verb || (o as any).userDecision?.userAction)),
    [rawOpportunities, decisions]
  );
  
  const router = useRouter();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterKey, setFilterKey] = useState<FilterKey>("ALL");
  const [tracking, setTracking] = useState<TrackingMap>({});
  const [activeTrack, setActiveTrack] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setTracking(readTracking());
  }, []);

  useEffect(() => {
    if (opportunitiesList) {
      ClientOpportunityCache.setList(opportunitiesList);
    }
  }, [opportunitiesList]);

  const updateTracking = (jobHash: string, key: keyof TrackingData, value: string) => {
    setTracking((prev) => {
      const current = prev[jobHash] || { latestConversation: "", nextAction: "", followUpDate: "" };
      const updated = { ...current, [key]: value };
      const next = { ...prev, [jobHash]: updated };
      writeTracking(next);
      return next;
    });
  };

  const toggleTrack = (jobHash: string) => {
    setActiveTrack(prev => ({ ...prev, [jobHash]: !prev[jobHash] }));
  };

  // Helper to get effective user decision verb for an opportunity
  const getUserVerb = (o: Opportunity | ServedOpportunity): DecisionVerb | null => {
    const recorded = decisions[o.jobHash];
    if (recorded?.verb) return recorded.verb;
    if ((o as any).userDecision?.userAction) return (o as any).userDecision.userAction as DecisionVerb;
    return null;
  };

  // Calculate filter counts across the complete accessible pipeline
  const counts = useMemo(() => {
    let pursue = 0;
    let consider = 0;
    let pass = 0;
    let unreviewed = 0;

    for (const o of opportunitiesList) {
      const verb = getUserVerb(o);
      if (verb === "PURSUE") pursue++;
      else if (verb === "CONSIDER") consider++;
      else if (verb === "PASS") pass++;
      else unreviewed++;
    }

    return {
      all: opportunitiesList.length,
      pursue,
      consider,
      pass,
      unreviewed,
    };
  }, [opportunitiesList, decisions]);

  // Combined Search + Decision Filter Composition
  const displayedOpportunities = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();

    return opportunitiesList.filter((o) => {
      const verb = getUserVerb(o);

      // 1. Decision Filter Match
      let matchesFilter = false;
      if (filterKey === "ALL") matchesFilter = true;
      else if (filterKey === "PURSUE") matchesFilter = verb === "PURSUE";
      else if (filterKey === "CONSIDER") matchesFilter = verb === "CONSIDER";
      else if (filterKey === "PASS") matchesFilter = verb === "PASS";
      else if (filterKey === "UNREVIEWED") matchesFilter = !verb;

      if (!matchesFilter) return false;

      // 2. Search Query Match
      if (!q) return true;
      const company = (o.company || "").toLowerCase();
      const role = (o.role || "").toLowerCase();
      const location = (o.location || "").toLowerCase();

      return company.includes(q) || role.includes(q) || location.includes(q);
    });
  }, [opportunitiesList, decisions, filterKey, searchQuery]);

  return (
    <div className="min-h-screen bg-background text-ink font-sans pb-24">
      {/* Page Header — Executive Control Panel */}
      <section className="mx-auto max-w-[1180px] px-5 sm:px-8 pb-8 pt-12 border-b border-border">
        <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4">
          <div>
            <p className="label-mono font-normal text-ink-muted">Opportunity Control Plane</p>
            <h1 className="mt-2 font-serif text-[3rem] sm:text-[3.25rem] leading-[0.95] tracking-tight text-ink font-normal">
              Your opportunities.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted font-normal">
              Search, filter and revisit mandates across your pipeline. Control your evaluation history and active pursuits.
            </p>
          </div>
          {Object.keys(decisions).length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (confirm("Clear all recorded decisions? This can't be undone.")) {
                  clear();
                  router.invalidate();
                }
              }}
              className="text-xs font-medium uppercase tracking-[0.14em] text-ink-muted hover:text-ink transition-colors self-start sm:self-auto"
            >
              Clear decisions
            </button>
          )}
        </div>

        {/* Search & Filter Control Surface */}
        <div className="mt-8 space-y-4">
          {/* Search Input Control */}
          <div className="relative max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search organisation or role"
              className="w-full bg-surface-raised border border-border px-4 py-2.5 text-sm text-ink placeholder:text-ink-muted/60 focus:outline-none focus:border-border-strong rounded-md transition-colors font-sans"
              data-testid="opportunity-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ink-muted hover:text-ink px-1"
              >
                ✕
              </button>
            )}
          </div>

          {/* Decision Filter Pills */}
          <div className="flex flex-wrap items-center gap-2 pt-1" data-testid="decision-filter-bar">
            <FilterPill
              label="ALL"
              count={counts.all}
              active={filterKey === "ALL"}
              onClick={() => setFilterKey("ALL")}
            />
            <FilterPill
              label="PURSUED"
              count={counts.pursue}
              active={filterKey === "PURSUE"}
              onClick={() => setFilterKey("PURSUE")}
              tint="pursue"
            />
            <FilterPill
              label="CONSIDERED"
              count={counts.consider}
              active={filterKey === "CONSIDER"}
              onClick={() => setFilterKey("CONSIDER")}
              tint="consider"
            />
            <FilterPill
              label="PASSED"
              count={counts.pass}
              active={filterKey === "PASS"}
              onClick={() => setFilterKey("PASS")}
              tint="pass"
            />
            <FilterPill
              label="UNREVIEWED"
              count={counts.unreviewed}
              active={filterKey === "UNREVIEWED"}
              onClick={() => setFilterKey("UNREVIEWED")}
            />
          </div>
        </div>
      </section>

      {/* Main Opportunities List Surface */}
      <main className="mx-auto max-w-[1180px] px-5 sm:px-8 pt-8">
        {!hydrated ? (
          <p className="text-sm text-ink-muted font-mono uppercase tracking-wider py-8">Loading pipeline opportunities…</p>
        ) : displayedOpportunities.length === 0 ? (
          <div className="py-16 text-center border border-dashed border-border rounded-md bg-surface-raised/30">
            <p className="text-sm text-ink-muted font-normal">
              {searchQuery.trim()
                ? `No opportunities match "${searchQuery.trim()}".`
                : filterKey !== "ALL"
                  ? `No ${filterKey.toLowerCase()} opportunities found.`
                  : "No opportunities currently in pipeline."}
            </p>
            {(searchQuery.trim() || filterKey !== "ALL") && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setFilterKey("ALL");
                }}
                className="mt-3 text-xs font-mono uppercase tracking-wider text-accent-ink hover:underline"
              >
                Reset filters & search
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-5" data-testid="opportunities-list">
            <div className="flex items-center justify-between text-xs text-ink-muted font-mono uppercase tracking-wider pb-2 border-b border-hairline">
              <span>Displaying {displayedOpportunities.length} of {opportunitiesList.length} mandates</span>
              <span>Sorted by Pipeline Recency</span>
            </div>

            {displayedOpportunities.map((o: any) => {
              const verb = getUserVerb(o);
              const applicationAction = applicationActionFor(o);

              // Tracking values
              const trackData = tracking[o.jobHash] || { latestConversation: "", nextAction: "", followUpDate: "" };

              const secondaryActionContext = trackData.nextAction;
              const isTrackOpen = !!activeTrack[o.jobHash];

              return (
                <div
                  key={o.jobHash}
                  className="memo-card border border-border bg-surface-raised p-6 rounded-md transition-all hover:border-border-strong"
                  data-testid={`opportunity-card-${o.jobHash}`}
                >
                  {/* Top Row: Primary Designation Identity + Decision Controls */}
                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      {/* PRIMARY IDENTITY HEADER: Designation / Role Title */}
                      <h3 className="font-serif text-[1.65rem] leading-[1.1] text-ink tracking-tight font-normal">
                        <Link
                          to="/opportunity/$jobHash"
                          params={{ jobHash: o.jobHash }}
                          className="hover:underline hover:text-accent-ink transition-colors"
                          data-testid={`opportunity-role-link-${o.jobHash}`}
                        >
                          {o.role || "Executive Role"}
                        </Link>
                      </h3>

                      {/* SECONDARY IDENTITY: Organisation + Location + Source */}
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                        <span className="font-semibold text-ink">{o.company}</span>
                        <span className="text-hairline-strong">·</span>
                        <span>{o.location}</span>
                        {o.scrapedFrom && (
                          <>
                            <span className="text-hairline-strong">·</span>
                            <span className="text-ink-muted/80">{o.scrapedFrom}</span>
                          </>
                        )}
                        <span className="text-hairline-strong">·</span>
                        <span className="font-mono uppercase tracking-[0.14em] text-[0.62rem] text-accent-ink/90 bg-accent-ink/5 px-2 py-0.5 rounded-sm">
                          {resolveDecisionsCardScore(o as any)}
                        </span>
                      </div>

                      {/* SECONDARY ACTION CONTEXT (Subdued, non-dominant) */}
                      {secondaryActionContext && (
                        <p className="mt-2 text-xs text-ink-muted/90 font-sans italic">
                          <span className="font-mono not-italic uppercase tracking-wider text-[0.6rem] text-ink-muted mr-1.5">Focus:</span>
                          {secondaryActionContext}
                        </p>
                      )}
                    </div>

                    {/* Right-aligned Decision Badge & Controls */}
                    <div className="flex items-center gap-3 shrink-0">
                      {verb ? (
                        <DecisionBadge verb={verb} size="sm" />
                      ) : (
                        <span className="text-[0.62rem] font-mono uppercase tracking-[0.14em] text-ink-muted bg-surface/80 border border-hairline px-2.5 py-1 rounded-sm">
                          UNREVIEWED
                        </span>
                      )}

                      {/* OPEN OPPORTUNITY Button */}
                      <Link
                        to="/opportunity/$jobHash"
                        params={{ jobHash: o.jobHash }}
                        className="rounded-sm border border-border px-3 py-1 label-mono text-xs text-ink hover:bg-background hover:text-accent-ink transition-colors"
                        data-testid={`open-opportunity-btn-${o.jobHash}`}
                      >
                        Open
                      </Link>

                      {/* UNDO Button */}
                      {verb && (
                        <button
                          type="button"
                          onClick={() => {
                            undo(o.jobHash);
                            router.invalidate();
                          }}
                          className="rounded-sm border border-hairline px-3 py-1 label-mono text-xs text-ink-muted hover:bg-background hover:text-ink transition-colors"
                          data-testid={`undo-btn-${o.jobHash}`}
                        >
                          Undo
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expandable Prepare & Track triggers for decided roles */}
                  {verb && verb !== "PASS" && (
                    <div className="flex items-center gap-4 border-t border-hairline mt-5 pt-3">
                      <button
                        type="button"
                        onClick={() => toggleTrack(o.jobHash)}
                        className={`text-xs uppercase tracking-[0.14em] font-mono cursor-pointer transition-colors ${
                          isTrackOpen ? "text-ink font-semibold border-b border-ink" : "text-ink-muted hover:text-ink"
                        }`}
                      >
                        Track
                      </button>
                      {verb === "PURSUE" && applicationAction && (
                        <a
                          href={applicationAction.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-xs uppercase tracking-[0.14em] font-mono text-decision-pursue hover:underline"
                        >
                          {applicationAction.label} ↗
                        </a>
                      )}
                    </div>
                  )}


                  {/* Expanded Track Drawer */}
                  {isTrackOpen && (
                    <div className="mt-4 p-4 border border-hairline bg-background/50 rounded-sm animate-reveal">
                      <p className="label-mono text-[0.6rem] text-ink-muted mb-3">What happened last time?</p>
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div>
                          <label className="text-[0.6rem] font-mono uppercase tracking-[0.12em] text-ink-muted block mb-1">Latest Conversation</label>
                          <input
                            type="text"
                            value={trackData.latestConversation}
                            onChange={(e) => updateTracking(o.jobHash, "latestConversation", e.target.value)}
                            placeholder="e.g. Recruiter call scheduled"
                            className="w-full bg-background border border-hairline px-3 py-2 text-xs text-ink focus:outline-none focus:border-border-strong rounded-sm"
                          />
                        </div>
                        <div>
                          <label className="text-[0.6rem] font-mono uppercase tracking-[0.12em] text-ink-muted block mb-1">Next Action Override</label>
                          <input
                            type="text"
                            value={trackData.nextAction}
                            onChange={(e) => updateTracking(o.jobHash, "nextAction", e.target.value)}
                            placeholder="e.g. Follow up on Thursday"
                            className="w-full bg-background border border-hairline px-3 py-2 text-xs text-ink focus:outline-none focus:border-border-strong rounded-sm"
                          />
                        </div>
                        <div>
                          <label className="text-[0.6rem] font-mono uppercase tracking-[0.12em] text-ink-muted block mb-1">Follow-up Date</label>
                          <input
                            type="text"
                            value={trackData.followUpDate}
                            onChange={(e) => updateTracking(o.jobHash, "followUpDate", e.target.value)}
                            placeholder="e.g. 12 Aug 2026"
                            className="w-full bg-background border border-hairline px-3 py-2 text-xs text-ink focus:outline-none focus:border-border-strong rounded-sm"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

function FilterPill({
  label,
  count,
  active,
  onClick,
  tint,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  tint?: "pursue" | "consider" | "pass";
}) {
  let activeStyles = "bg-ink text-background font-semibold border-ink";
  let inactiveStyles = "bg-surface-raised/80 text-ink-muted hover:text-ink hover:border-border-strong border-border";

  if (active && tint === "pursue") {
    activeStyles = "bg-decision-pursue text-white font-semibold border-decision-pursue";
  } else if (active && tint === "consider") {
    activeStyles = "bg-decision-consider text-white font-semibold border-decision-consider";
  } else if (active && tint === "pass") {
    activeStyles = "bg-ink-muted text-background font-semibold border-ink-muted";
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 rounded-full border text-xs font-mono uppercase tracking-wider transition-all flex items-center gap-1.5 ${
        active ? activeStyles : inactiveStyles
      }`}
      data-testid={`filter-pill-${label.toLowerCase()}`}
    >
      <span>{label}</span>
      <span className={`text-[0.65rem] px-1.5 py-0.2 rounded-full ${active ? "bg-white/20 text-white" : "bg-hairline text-ink-muted"}`}>
        {count}
      </span>
    </button>
  );
}
