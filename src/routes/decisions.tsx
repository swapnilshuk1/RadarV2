import {
  type ServedOpportunity,
  isEvaluated,
  isUnavailable,
  type EvaluatedOpportunity,
} from "@/opportunity/contracts";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useMemo, useCallback } from "react";
import type { DecisionVerb, Opportunity } from "@/opportunity/contracts";
import { applicationActionFor } from "@/opportunity/application-action";
import { useDecisions } from "../lib/decisions-store";
import { PursuitLauncherProvider, usePursuitLauncher } from "@/pursuit/components/PursuitLauncher";
import { useSkin } from "@/components/skins/useSkin";
import { DECISIONS_LAYOUTS, type DecisionsRow } from "@/components/skins/layouts/decisions-layouts";
import { getDecidedOpportunitiesFn } from "@/opportunity/server";
import { listPursuitSummariesFn } from "../pursuit/server";
import { isTerminalPursuitStatus, pursuitStatusLabels } from "../pursuit/types";

export const Route = createFileRoute("/decisions")({
  head: () => ({
    meta: [
      { title: "Your opportunities — RADAR" },
      {
        name: "description",
        content:
          "Your active executive pipeline: search, filter, revisit and control opportunities across your pipeline.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  staleTime: 0,
  loader: async ({ location }) => {
    const raw = location.search as { tenantId?: unknown; personId?: unknown };
    const scope = {
      tenantId: typeof raw.tenantId === "string" ? raw.tenantId : undefined,
      personId: typeof raw.personId === "string" ? raw.personId : undefined,
    };
    if (Boolean(scope.tenantId) !== Boolean(scope.personId))
      throw new Error("CANDIDATE_SCOPE_INCOMPLETE");
    const [opportunitiesList, pursuitSummaries] = await Promise.all([
      getDecidedOpportunitiesFn({ data: scope }),
      listPursuitSummariesFn({ data: scope }),
    ]);
    return { opportunitiesList, pursuitSummaries, scope };
  },
  component: OpportunitiesPageRoot,
});

export function resolveDecisionsCardScore(o: Opportunity): string {
  const score = o.engineRecommendation?.qualityScore;
  if (score !== null && score !== undefined) {
    return `Fit Index ${score}%`;
  }
  if (o.engineRecommendation?.vetoed) {
    return `Vetoed (${o.engineRecommendation.vetoReason || "Mismatch"})`;
  }
  return o.engineRecommendation?.engineVerdict || "Unscored";
}

export type FilterKey = "ALL" | "PURSUE" | "CONSIDER" | "PASS";
type PursuitBucket = "ACTIVE" | "WON" | "CLOSED";

/** Any mandate already marked PURSUE must be able to reopen its cockpit. */
function OpportunitiesPageRoot() {
  const { scope } = Route.useLoaderData();
  return (
    <PursuitLauncherProvider scope={scope}>
      <OpportunitiesPage />
    </PursuitLauncherProvider>
  );
}

function OpportunitiesPage() {
  const { opportunitiesList: loadedOpportunities, pursuitSummaries, scope } = Route.useLoaderData();
  const pursuitsByJobHash = useMemo(
    () => new Map(pursuitSummaries.map((summary) => [summary.jobHash, summary])),
    [pursuitSummaries],
  );
  const { decisions, undo, clear, hydrated, error: decisionError } = useDecisions(scope);
  const rawOpportunities = loadedOpportunities as Array<Opportunity | ServedOpportunity>;
  // Phase 4: Non-evaluated variants without decisions must not contribute to counts or enter the ledger.
  // Explicit user decisions (including those on sparse specifications) remain preserved and represented.
  const opportunitiesList = useMemo(
    () =>
      rawOpportunities.filter(
        (o) =>
          isEvaluated(o) ||
          Boolean(decisions[o.jobHash]?.verb || (o as any).userDecision?.userAction),
      ),
    [rawOpportunities, decisions],
  );

  const pursuit = usePursuitLauncher();
  const router = useRouter();
  const skin = useSkin();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterKey, setFilterKey] = useState<FilterKey>("ALL");
  const [pursuitBucket, setPursuitBucket] = useState<PursuitBucket>("ACTIVE");
  const [writeError, setWriteError] = useState<string | null>(null);

  // Helper to get effective user decision verb for an opportunity
  const getUserVerb = useCallback(
    (o: Opportunity | ServedOpportunity): DecisionVerb | null => {
      const recorded = decisions[o.jobHash];
      if (recorded?.verb) return recorded.verb;
      if ((o as any).userDecision?.userAction)
        return (o as any).userDecision.userAction as DecisionVerb;
      return null;
    },
    [decisions],
  );

  // Calculate filter counts across the complete accessible pipeline
  const counts = useMemo(() => {
    let pursue = 0;
    let consider = 0;
    let pass = 0;

    for (const o of opportunitiesList) {
      const verb = getUserVerb(o);
      if (verb === "PURSUE") pursue++;
      else if (verb === "CONSIDER") consider++;
      else if (verb === "PASS") pass++;
    }

    return {
      all: opportunitiesList.length,
      pursue,
      consider,
      pass,
    };
  }, [opportunitiesList, getUserVerb]);

  const pursuitBucketCounts = useMemo(() => {
    let active = 0;
    let won = 0;
    let closed = 0;
    for (const summary of pursuitSummaries) {
      if (summary.status === "CLOSED_WON") won++;
      else if (isTerminalPursuitStatus(summary.status)) closed++;
      else active++;
    }
    return { active, won, closed };
  }, [pursuitSummaries]);

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

      if (!matchesFilter) return false;

      if (filterKey === "PURSUE") {
        const summary = pursuitsByJobHash.get(o.jobHash);
        const bucket: PursuitBucket = !summary
          ? "ACTIVE"
          : summary.status === "CLOSED_WON"
            ? "WON"
            : isTerminalPursuitStatus(summary.status)
              ? "CLOSED"
              : "ACTIVE";
        if (bucket !== pursuitBucket) return false;
      }

      // 2. Search Query Match
      if (!q) return true;
      const company = (o.company || "").toLowerCase();
      const role = (o.role || "").toLowerCase();
      const location = (o.location || "").toLowerCase();

      return company.includes(q) || role.includes(q) || location.includes(q);
    });
  }, [opportunitiesList, filterKey, pursuitBucket, pursuitsByJobHash, searchQuery, getUserVerb]);

  const rows: DecisionsRow[] = displayedOpportunities.map((o) => ({
    jobHash: o.jobHash,
    role: o.role || "Executive Role",
    company: o.company,
    location: o.location,
    scrapedFrom: o.scrapedFrom,
    score: resolveDecisionsCardScore(o as Opportunity),
    thesis: (o as Opportunity).recommendation || (o as Opportunity).primaryProof?.headline || "",
    fit:
      typeof (o as Opportunity).engineRecommendation?.qualityScore === "number"
        ? (o as Opportunity).engineRecommendation!.qualityScore!
        : null,
    verb: getUserVerb(o),
    applicationAction: applicationActionFor(o as Opportunity) ?? null,
    pursuitSummary: pursuitsByJobHash.get(o.jobHash),
  }));
  const handleUndo = async (jobHash: string) => {
    try {
      await undo(jobHash);
      await router.invalidate();
    } catch (error: any) {
      setWriteError(error?.message || "Could not remove this decision.");
    }
  };
  const Layout =
    skin === "iphone"
      ? DECISIONS_LAYOUTS.radar
      : (DECISIONS_LAYOUTS[skin] ?? DECISIONS_LAYOUTS.radar);

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
              Search, filter and revisit mandates across your pipeline. Control your evaluation
              history and active pursuits.
            </p>
          </div>
          {Object.keys(decisions).length > 0 && (
            <button
              type="button"
              onClick={async () => {
                if (confirm("Clear all recorded decisions? This can't be undone.")) {
                  try {
                    await clear();
                    await router.invalidate();
                  } catch (error: any) {
                    setWriteError(error?.message || "Could not clear decisions.");
                  }
                }
              }}
              className="text-xs font-medium uppercase tracking-[0.14em] text-ink-muted hover:text-ink transition-colors self-start sm:self-auto"
            >
              Clear decisions
            </button>
          )}
          {(writeError || decisionError) && (
            <p role="alert" className="mt-2 text-sm text-decision-pass">
              {writeError || decisionError}
            </p>
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
              onClick={() => {
                setFilterKey("PURSUE");
                setPursuitBucket("ACTIVE");
              }}
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
          </div>
          {filterKey === "PURSUE" && (
            <div
              className="flex flex-wrap items-center gap-2 pt-1"
              data-testid="pursuit-lifecycle-filter-bar"
            >
              <FilterPill
                label="ACTIVE"
                count={pursuitBucketCounts.active}
                active={pursuitBucket === "ACTIVE"}
                onClick={() => setPursuitBucket("ACTIVE")}
              />
              <FilterPill
                label="WON"
                count={pursuitBucketCounts.won}
                active={pursuitBucket === "WON"}
                onClick={() => setPursuitBucket("WON")}
              />
              <FilterPill
                label="CLOSED"
                count={pursuitBucketCounts.closed}
                active={pursuitBucket === "CLOSED"}
                onClick={() => setPursuitBucket("CLOSED")}
              />
            </div>
          )}
        </div>
      </section>

      {/* Main Opportunities List Surface */}
      <main className="mx-auto max-w-[1180px] px-5 sm:px-8 pt-8">
        {!hydrated ? (
          <p className="text-sm text-ink-muted font-mono uppercase tracking-wider py-8">
            Loading pipeline opportunities…
          </p>
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
                  setPursuitBucket("ACTIVE");
                }}
                className="mt-3 text-xs font-mono uppercase tracking-wider text-accent-ink hover:underline"
              >
                Reset filters & search
              </button>
            )}
          </div>
        ) : (
          <Layout
            rows={rows}
            scope={scope}
            displayedCount={displayedOpportunities.length}
            totalCount={opportunitiesList.length}
            pursuitPending={pursuit.pending}
            onUndo={handleUndo}
            onLaunchPursuit={(jobHash) => void pursuit.launch(jobHash)}
          />
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
  let inactiveStyles =
    "bg-surface-raised/80 text-ink-muted hover:text-ink hover:border-border-strong border-border";

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
      <span
        className={`text-[0.65rem] px-1.5 py-0.2 rounded-full ${active ? "bg-white/20 text-white" : "bg-hairline text-ink-muted"}`}
      >
        {count}
      </span>
    </button>
  );
}
