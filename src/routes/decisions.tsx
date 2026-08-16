import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { applyUrlFor, type DecisionVerb, type Opportunity } from "../data/opportunity-fixtures";
import { useDecisions, type DecisionRecord } from "../lib/decisions-store";
import { DecisionBadge } from "../components/radar/DecisionBadge";
import { getOpportunitiesFn } from "../lib/intelligence/opportunity-server";

// Recomposition elements
import { BriefCompositionEngine } from "../lib/intelligence/editorial/BriefCompositionEngine";
import { JobProjectionBuilder } from "../lib/intelligence/builders/JobProjectionBuilder";
import { CandidateProjectionBuilderImpl } from "../lib/intelligence/builders/CandidateProjectionBuilder";
import { ExecutionEngine } from "../lib/intelligence/engines/ExecutionEngine";
import { candidateProfile } from "../data/candidate-profile";

export const Route = createFileRoute("/decisions")({
  head: () => ({
    meta: [
      { title: "Your opportunities — RADAR" },
      { name: "description", content: "Your active executive pipeline: prepare CV, validate recruiter questions, and track conversations." },
      { name: "robots", content: "noindex" },
    ],
  }),
  staleTime: 0,
  loader: async () => {
    return {
      opportunitiesList: await getOpportunitiesFn()
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

type Row = {
  jobHash: string;
  record: DecisionRecord;
  role: string;
  company: string;
  location: string;
  scrapedFrom: "LinkedIn" | "Naukri" | "Indeed";
  applyUrl: string;
  opportunity: Opportunity;
};

function OpportunitiesPage() {
  const { decisions, undo, clear, hydrated } = useDecisions();
  const { opportunitiesList } = Route.useLoaderData();
  const router = useRouter();

  const [tracking, setTracking] = useState<TrackingMap>({});
  const [activePrepare, setActivePrepare] = useState<Record<string, boolean>>({});
  const [activeTrack, setActiveTrack] = useState<Record<string, boolean>>({});

  useEffect(() => {
    setTracking(readTracking());
  }, []);

  const updateTracking = (jobHash: string, key: keyof TrackingData, value: string) => {
    setTracking((prev) => {
      const current = prev[jobHash] || { latestConversation: "", nextAction: "", followUpDate: "" };
      const updated = { ...current, [key]: value };
      const next = { ...prev, [jobHash]: updated };
      writeTracking(next);
      return next;
    });
  };

  const rows: Row[] = Object.entries(decisions)
    .map(([jobHash, record]) => {
      const o = opportunitiesList.find(opp => opp.jobHash === jobHash);
      if (!o) return null;
      return {
        jobHash,
        record,
        role: o.role,
        company: o.company,
        location: o.location,
        scrapedFrom: o.scrapedFrom,
        applyUrl: applyUrlFor(o),
        opportunity: o,
      };
    })
    .filter((r): r is Row => r !== null)
    .sort((a, b) => b.record.at - a.record.at);

  const activeRows = rows.filter(r => r.record.verb === "PURSUE" || r.record.verb === "CONSIDER");
  const passiveRows = rows.filter(r => r.record.verb === "PASS" || r.record.verb === "NOT_EVALUABLE");

  const countPursue = rows.filter(r => r.record.verb === "PURSUE").length;
  const countConsider = rows.filter(r => r.record.verb === "CONSIDER").length;

  const togglePrepare = (jobHash: string) => {
    setActivePrepare(prev => ({ ...prev, [jobHash]: !prev[jobHash] }));
  };

  const toggleTrack = (jobHash: string) => {
    setActiveTrack(prev => ({ ...prev, [jobHash]: !prev[jobHash] }));
  };

  return (
    <div className="min-h-screen bg-background text-ink font-sans pb-24">
      {/* Page Header */}
      <section className="mx-auto max-w-[1180px] px-5 sm:px-8 pb-10 pt-14 border-b border-border">
        <div className="flex items-baseline justify-between">
          <div>
            <p className="label-mono font-normal">Active Pipeline</p>
            <h1 className="mt-3 font-serif text-[3.25rem] leading-[0.92] tracking-tight text-ink font-normal">
              Your opportunities.
            </h1>
          </div>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (confirm("Clear all opportunities? This can't be undone.")) {
                  clear();
                  router.invalidate();
                }
              }}
              className="text-xs font-medium uppercase tracking-[0.14em] text-ink-muted hover:text-ink transition-colors"
            >
              Clear all
            </button>
          )}
        </div>
        <p className="mt-4 max-w-xl text-sm leading-relaxed text-ink-muted font-normal">
          {activeRows.length === 0
            ? "No active pursuits yet. Mark a brief as Pursue or Consider on the shortlist to begin executing."
            : `${activeRows.length} active opportunit${activeRows.length === 1 ? "y" : "ies"} in progression. Anchor your positioning and track next steps.`}
        </p>
        <div className="mt-6 flex gap-8 text-sm text-ink-muted">
          <Stat label="Pursued" value={countPursue} tint="text-decision-pursue" />
          <Stat label="Considered" value={countConsider} tint="text-decision-consider" />
          <Stat label="Passed" value={passiveRows.length} />
        </div>
      </section>

      {/* Main Opportunities List */}
      <main className="mx-auto max-w-[1180px] px-5 sm:px-8 pt-10">
        {!hydrated ? (
          <p className="text-sm text-ink-muted font-mono uppercase tracking-wider">Loading…</p>
        ) : activeRows.length === 0 ? (
          <div className="py-12 text-center border border-dashed border-border rounded-md bg-surface-raised/30">
            <p className="text-sm text-ink-muted">No active opportunities. Go to the shortlist to evaluate new briefs.</p>
          </div>
        ) : (
          <div className="space-y-6">
            <h2 className="label-mono text-ink-muted mb-4">Today's Priorities</h2>
            <div className="space-y-6">
              {activeRows.map((r) => {
                const o = r.opportunity;
                const verb = r.record.verb;

                // Recompose existing models
                const brief = BriefCompositionEngine.compose(o, { bypassHistory: true });
                const jobProj = JobProjectionBuilder.build(o);
                const candidateProj = new CandidateProjectionBuilderImpl().fromProfile(candidateProfile);
                const executionPkg = ExecutionEngine.validateDecision(candidateProj, jobProj);

                const score = o.recommendationResult?.score ?? 80;

                // Tracking values
                const trackData = tracking[r.jobHash] || { latestConversation: "", nextAction: "", followUpDate: "" };

                // Visual Hierarchy: "Next Action" First
                let nextActionDisplay = trackData.nextAction;
                if (!nextActionDisplay) {
                  if (verb === "PURSUE") {
                    const mandate = jobProj.trueExecutiveMandate || "COMMERCIAL_EXPANSION";
                    if (mandate === "TRANSFORMATION" || mandate === "TURNAROUND") {
                      nextActionDisplay = "Tailor your CV to emphasize Transformation before applying";
                    } else {
                      nextActionDisplay = "Tailor your CV to emphasize Commercial Growth before applying";
                    }
                  } else {
                    nextActionDisplay = "Verify reporting line altitude on initial screening";
                  }
                }

                const isPrepareOpen = !!activePrepare[r.jobHash];
                const isTrackOpen = !!activeTrack[r.jobHash];

                return (
                  <div key={r.jobHash} className="memo-card border border-border bg-surface-raised p-6 rounded-md animate-reveal">
                    {/* Header Row: Next Action & Action Buttons */}
                    <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                      <div className="min-w-0">
                        {/* Bold Next Action Header */}
                        <h3 className="font-display font-serif text-[1.65rem] leading-[1.1] text-ink tracking-tight font-normal">
                          {nextActionDisplay}
                        </h3>
                        {/* Subdued Company Context */}
                        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
                          <Link
                            to="/opportunity/$jobHash"
                            params={{ jobHash: r.jobHash }}
                            className="font-medium text-ink hover:underline"
                          >
                            {r.company}
                          </Link>
                          <span className="text-hairline-strong">·</span>
                          <span>{r.role}</span>
                          <span className="text-hairline-strong">·</span>
                          <span>{r.location}</span>
                          <span className="text-hairline-strong">·</span>
                          <span className="font-mono uppercase tracking-[0.14em] text-[0.62rem] text-accent-ink/90 bg-accent-ink/5 px-2 py-0.5 rounded-sm">
                            {o.recommendationResult?.score !== null && o.recommendationResult?.score !== undefined
                              ? `Fit Overlap ${o.recommendationResult.score}%`
                              : o.engineRecommendation?.vetoed
                                ? `Vetoed (${o.engineRecommendation.vetoReason || "Mismatch"})`
                                : "Unscored"}
                          </span>
                        </div>
                      </div>

                      {/* Right-aligned Badge and Undo */}
                      <div className="flex items-center gap-3 shrink-0">
                        <DecisionBadge verb={verb} size="sm" />
                        <button
                          type="button"
                          onClick={() => {
                            undo(r.jobHash);
                            router.invalidate();
                          }}
                          className="rounded-sm border border-hairline px-3 py-1 label-mono text-ink-muted hover:bg-background hover:text-ink transition-colors"
                        >
                          Undo
                        </button>
                      </div>
                    </div>

                    {/* Expandable Prepare & Track triggers */}
                    <div className="flex items-center gap-4 border-t border-hairline mt-5 pt-3">
                      <button
                        type="button"
                        onClick={() => togglePrepare(r.jobHash)}
                        className={`text-xs uppercase tracking-[0.14em] font-mono cursor-pointer transition-colors ${
                          isPrepareOpen ? "text-ink font-semibold border-b border-ink" : "text-ink-muted hover:text-ink"
                        }`}
                      >
                        Prepare
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleTrack(r.jobHash)}
                        className={`text-xs uppercase tracking-[0.14em] font-mono cursor-pointer transition-colors ${
                          isTrackOpen ? "text-ink font-semibold border-b border-ink" : "text-ink-muted hover:text-ink"
                        }`}
                      >
                        Track
                      </button>
                      {verb === "PURSUE" && (
                        <a
                          href={r.applyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-auto text-xs uppercase tracking-[0.14em] font-mono text-decision-pursue hover:underline"
                        >
                          Apply directly ↗
                        </a>
                      )}
                    </div>

                    {/* Expanded Prepare Drawer */}
                    {isPrepareOpen && (
                      <div className="mt-4 p-4 border border-hairline bg-background/50 rounded-sm animate-reveal">
                        <div>
                          <p className="label-mono text-[0.6rem] text-ink-muted">Resume Positioning Anchor</p>
                          <p className="text-base text-ink mt-1 font-serif italic leading-snug">
                            {brief.strategy.focusTitle || `Highlight multi-market commercial GTM operations and digital governance scaling.`}
                          </p>
                        </div>

                        <div className="mt-4 border-t border-hairline pt-3">
                          <p className="label-mono text-[0.6rem] text-ink-muted mb-2">Questions to Validate during screening</p>
                          <ul className="space-y-3">
                            {executionPkg.screeningQuestions.map((q, idx) => (
                              <li key={idx} className="text-sm">
                                <span className="font-mono text-[0.72rem] font-semibold block text-accent-ink/90">
                                  {idx + 1}. {q.question}
                                </span>
                                <span className="text-[0.78rem] text-ink-muted leading-relaxed mt-0.5 block">
                                  {q.whyItMatters}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
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
                              onChange={(e) => updateTracking(r.jobHash, "latestConversation", e.target.value)}
                              placeholder="e.g. Recruiter call scheduled"
                              className="w-full bg-background border border-hairline px-3 py-2 text-xs text-ink focus:outline-none focus:border-border-strong rounded-sm"
                            />
                          </div>
                          <div>
                            <label className="text-[0.6rem] font-mono uppercase tracking-[0.12em] text-ink-muted block mb-1">Next Action Override</label>
                            <input
                              type="text"
                              value={trackData.nextAction}
                              onChange={(e) => updateTracking(r.jobHash, "nextAction", e.target.value)}
                              placeholder="e.g. Follow up on Thursday"
                              className="w-full bg-background border border-hairline px-3 py-2 text-xs text-ink focus:outline-none focus:border-border-strong rounded-sm"
                            />
                          </div>
                          <div>
                            <label className="text-[0.6rem] font-mono uppercase tracking-[0.12em] text-ink-muted block mb-1">Follow-up Date</label>
                            <input
                              type="text"
                              value={trackData.followUpDate}
                              onChange={(e) => updateTracking(r.jobHash, "followUpDate", e.target.value)}
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
          </div>
        )}

        {/* Passive rows (Passed & Not Evaluable) minimal section at the bottom */}
        {hydrated && passiveRows.length > 0 && (
          <section className="mt-16 border-t border-hairline pt-8">
            <h2 className="label-mono text-ink-muted mb-4">Archive</h2>
            <ul className="space-y-2">
              {passiveRows.map((r) => (
                <li key={r.jobHash} className="flex items-center justify-between py-2 border-b border-hairline text-sm">
                  <span className="truncate">
                    <span className="text-ink font-medium">{r.company}</span>
                    <span className="mx-1.5 text-ink-muted">·</span>
                    <span className="text-ink-muted">{r.role}</span>
                  </span>
                  <div className="flex items-center gap-3 shrink-0 pl-4">
                    <span className="text-[0.62rem] font-mono uppercase tracking-wider text-ink-muted">
                      {r.record.verb}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        undo(r.jobHash);
                        router.invalidate();
                      }}
                      className="text-xs uppercase tracking-[0.14em] font-mono text-ink-muted hover:text-ink transition-colors"
                    >
                      Undo
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}

function Stat({ label, value, tint = "text-ink" }: { label: string; value: number; tint?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-2xl font-serif leading-none ${tint}`}>{value}</span>
      <span className="text-[0.62rem] font-mono uppercase tracking-[0.14em] text-ink-muted">{label}</span>
    </div>
  );
}
