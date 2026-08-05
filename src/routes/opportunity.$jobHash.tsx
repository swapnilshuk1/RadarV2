import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { applyUrlFor, type DecisionVerb } from "../data/opportunity-fixtures";
import { getOpportunityFn, getNeighboursFn, getQueueMetricsFn } from "../lib/intelligence/opportunity-server";
import { candidateProfile } from "../data/candidate-profile";
import { useDecisions } from "../lib/decisions-store";
import { BriefCompositionEngine } from "../lib/intelligence/editorial/BriefCompositionEngine";

export const Route = createFileRoute("/opportunity/$jobHash")({
  loader: async ({ params }: { params: { jobHash: string } }) => {
    const opportunity = await getOpportunityFn({ data: params.jobHash });
    if (!opportunity) throw notFound();
    const metrics = await getQueueMetricsFn({ data: params.jobHash });
    const neighbors = await getNeighboursFn({ data: params.jobHash });
    return {
      opportunity,
      neighbors,
      currentIndex: metrics.currentIndex,
      totalCount: metrics.totalCount,
    };
  },
  head: ({ loaderData }: { loaderData?: any }) => {
    if (!loaderData) {
      return { meta: [{ title: "Brief unavailable — RADAR" }, { name: "robots", content: "noindex" }] };
    }
    const o = loaderData.opportunity;
    return {
      meta: [
        { title: `${o.decision} · ${o.role} — RADAR Executive Dossier` },
        { name: "description", content: o.recommendation || "Executive advisory dossier" },
        { property: "og:title", content: `${o.decision} · ${o.role} at ${o.company}` },
        { property: "og:description", content: o.recommendation || "Executive advisory dossier" },
      ],
    };
  },
  component: OpportunityDossier,
});

function OpportunityDossier() {
  const loaderData = Route.useLoaderData() as {
    opportunity: any;
    neighbors: { prev: any | null; next: any | null };
    currentIndex: number;
    totalCount: number;
  };

  const { opportunity: o, neighbors, currentIndex, totalCount } = loaderData;
  const { decisions, decide: recordDecision } = useDecisions();
  const router = useRouter();

  const currentVerdict: DecisionVerb = (decisions[o.jobHash]?.verb as DecisionVerb) || o.decision;

  const decide = (verb: DecisionVerb) => {
    recordDecision(o.jobHash, verb);
    router.invalidate();
  };

  const brief = BriefCompositionEngine.compose(o);

  const [expandedReasoningRow, setExpandedReasoningRow] = useState<number | null>(0);
  const [checkedUnknowns, setCheckedUnknowns] = useState<Record<number, boolean>>({});

  const toggleCheck = (idx: number) => {
    setCheckedUnknowns((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const strongEvidenceDimensions = (o.evidenceDimensions || []).filter(
    (d: any) => d.jdEvidence?.confidence === "EXPLICIT_STRONG"
  );

  const partialEvidenceDimensions = (o.evidenceDimensions || []).filter(
    (d: any) => d.jdEvidence?.confidence !== "EXPLICIT_STRONG"
  );

  const allVerifiedCount = o.evidenceDimensions?.length || 7;

  const formatValue = (val: any) => {
    if (!val) return "Not specified in JD";
    if (typeof val === "string") return val;
    if (typeof val === "boolean") return val ? "Required" : "Optional";
    if (Array.isArray(val)) return val.join(", ");
    if (typeof val === "object") {
      return Object.entries(val)
        .map(([k, v]) => `${k}: ${v}`)
        .join(" | ");
    }
    return String(val);
  };

  return (
    <div className="min-h-screen pb-28 bg-background text-foreground font-sans">
      {/* ────────────────────────────────────────────────────────────────────────
          HEADER TITLE BLOCK
          ──────────────────────────────────────────────────────────────────────── */}
      <header className="border-b border-border">
        <div className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 sm:py-12">
          {/* Nav Sub-Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link to="/" className="label-mono hover:text-foreground transition-colors">
              ← Shortlist
            </Link>
            <span className="label-mono">
              Brief {String(currentIndex).padStart(2, "0")} of {totalCount}
            </span>
          </div>

          {/* Badges & Verbs */}
          <div className="mt-7 flex flex-wrap items-center gap-2">
            <span className="label-mono rounded-[3px] bg-signal px-1.5 py-[3px] leading-none text-signal-foreground font-bold">
              {currentVerdict === "PURSUE" ? "Pursue" : currentVerdict === "CONSIDER" ? "Consider" : "Pass"}
            </span>
            <span className="label-mono">Strong strategic fit</span>
            <span className="label-mono">· {brief.evidenceQuality}</span>
            <span className="label-mono hidden sm:inline">· 20 minute application</span>
          </div>

          {/* Headline Title */}
          <h1 className="mt-4 max-w-4xl font-display text-[2.6rem] leading-[1.02] tracking-tight sm:text-6xl text-foreground">
            {o.role} mandate at {o.company} focused on {o.primaryDriver || "growth strategy and commercial performance."}
          </h1>

          {/* Subtitle Company Line */}
          <p className="mt-4 border-t border-border pt-4 font-mono text-xs tracking-[0.12em] uppercase text-muted-foreground">
            <span className="text-foreground font-bold">{o.company}</span> · {o.location} (On-site)
          </p>
        </div>
      </header>

      {/* ────────────────────────────────────────────────────────────────────────
          EXECUTIVE BRIEF HIGHLIGHT BANNER
          ──────────────────────────────────────────────────────────────────────── */}
      <section className="border-b border-border bg-surface-raised">
        <div className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 sm:py-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="label-mono text-primary font-bold">If you only read one thing</span>
            <span className="label-mono">1-minute executive brief</span>
          </div>
          <p className="mt-4 font-display text-3xl leading-tight sm:text-4xl text-foreground">
            {currentVerdict === "PURSUE" ? "Worth pursuing." : currentVerdict === "CONSIDER" ? "Worth considering." : "Pass on this mandate."}
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="border-l-2 border-signal pl-4">
              <p className="label-mono text-signal font-bold">Why pursue</p>
              <ul className="mt-2.5 space-y-2.5">
                {brief.oneMinuteTLDR.whyPursue.map((item: string, i: number) => (
                  <li key={i} className="text-sm leading-relaxed text-foreground">
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-l-2 border-caution pl-4">
              <p className="label-mono text-caution font-bold">Watch for</p>
              <ul className="mt-2.5 space-y-2.5">
                {brief.oneMinuteTLDR.watchFor.map((item: string, i: number) => (
                  <li key={i} className="text-sm leading-relaxed text-foreground">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────────────
          MAIN EDITORIAL SECTIONS (UNBOXED SEAMLESS FLOW)
          ──────────────────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-[1180px] space-y-12 px-5 py-12 sm:px-8 sm:space-y-16">
        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 1: STRATEGIC CAREER VALUE (CHAPTER I)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong">I</p>
            <p className="label-mono mt-2">Strategic career value</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block">
              What this mandate does to your record.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground">
              Why this role is interesting
            </h2>
            <div className="mt-5">
              <ol className="divide-y divide-border border-y border-border">
                {brief.strategicUpside.points.map((point: string, i: number) => (
                  <li key={i} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 py-4">
                    <span className="label-mono tabular-nums text-border-strong font-bold">
                      0{i + 1}
                    </span>
                    <p className="text-sm leading-relaxed text-foreground">
                      {point}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 2: EXPLAINABLE REASONING (CHAPTER II)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong">II</p>
            <p className="label-mono mt-2">Explainable reasoning</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block">
              Every score is traceable to evidence.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground">
              Why this recommendation?
            </h2>
            <div className="mt-5">
              <div className="divide-y divide-border border-y border-border">
                {brief.qualitativeReasoningChain.map((row: any, idx: number) => (
                  <div key={idx}>
                    <button
                      type="button"
                      onClick={() => setExpandedReasoningRow(expandedReasoningRow === idx ? null : idx)}
                      className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-4 text-left cursor-pointer group"
                    >
                      <span className="label-mono truncate text-foreground font-bold">
                        {row.layer}
                      </span>
                      <span className="flex shrink-0 items-center gap-4">
                        <span className="font-mono text-xs text-primary font-bold">{row.ratingLabel}</span>
                        <span className="label-mono text-muted-foreground group-hover:text-foreground">
                          {expandedReasoningRow === idx ? "− Hide" : "+ Why"}
                        </span>
                      </span>
                    </button>

                    {expandedReasoningRow === idx && (
                      <div className="pb-5">
                        <ul className="space-y-1.5">
                          {row.becausePoints.map((b: string, bIdx: number) => (
                            <li key={bIdx} className="flex gap-2 text-sm text-foreground">
                              <span className="text-signal font-bold">✓</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-4 border-l-2 border-border-strong pl-3 font-display text-base italic text-muted-foreground">
                          “{row.evidenceSnippet}”
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 3: THE CASE (CHAPTER III)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong">III</p>
            <p className="label-mono mt-2">The call</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block">
              The honest version.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground">
              Yes — but for a very specific reason.
            </h2>

            <div className="mt-5">
              <p className="max-w-2xl font-display text-xl leading-relaxed sm:text-2xl text-foreground">
                A solid tactical fit. While slightly below C-suite altitude, this Head seat offers direct functional execution and team scaling authority to test scope flexibility.
              </p>

              <p className="mt-5 border-l-2 border-caution pl-4 text-sm leading-relaxed text-muted-foreground">
                <span className="label-mono block text-caution font-bold">Why it is not a stronger call</span>
                {brief.whyNotStronger}
              </p>

              <dl className="mt-7 divide-y divide-border border-y border-border">
                {brief.proofPoints.slice(0, 3).map((proof: any, i: number) => (
                  <div key={i} className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                    <dt className="label-mono font-bold text-foreground">
                      {proof.category === "Direct Evidence" ? "Core strength" : "Transferable strength"}
                    </dt>
                    <dd className="min-w-0">
                      <p className="font-display text-lg leading-snug text-foreground">{proof.headline}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{proof.detail}</p>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 4: THE ROLE (CHAPTER IV)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong">IV</p>
            <p className="label-mono mt-2">The mandate</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block">
              First three quarters, as written.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground">
              What will you be expected to deliver?
            </h2>

            <div className="mt-5">
              <ol className="border-l border-border pl-6 space-y-8">
                {brief.deliverablesWork.map((item: string, i: number) => (
                  <li key={i} className="relative last:pb-0">
                    <span className="absolute -left-[28.5px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="label-mono text-primary font-bold">Month {i * 3 + 3}</span>
                      <span className="label-mono">
                        {brief.deliverablesProvenance[i] === "Observed in JD" ? "Observed in JD" : "Inferred Pattern"}
                      </span>
                    </div>
                    <p className="mt-1.5 font-display text-xl leading-snug text-foreground">
                      {item}
                    </p>
                    {brief.deliverablesValue[i] && (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                        <span className="label-mono text-signal font-bold">Outcome</span> {brief.deliverablesValue[i]}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 5: YOUR ADVANTAGE (CHAPTER V)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong">V</p>
            <p className="label-mono mt-2">Your advantage</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block">
              Where your record maps onto the ask.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground">
              Why RADAR believes you're well positioned
            </h2>

            <div className="mt-5">
              <dl className="divide-y divide-border border-y border-border">
                {brief.proofPoints.map((proof: any, i: number) => (
                  <div key={i} className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                    <dt className="label-mono text-signal font-bold">
                      {proof.category === "Direct Evidence" ? "Direct evidence" : "Transferable experience"}
                    </dt>
                    <dd className="min-w-0">
                      <p className="font-display text-lg leading-snug text-foreground">{proof.headline}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{proof.detail}</p>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 6: OPEN QUESTIONS (CHAPTER VI)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong">VI</p>
            <p className="label-mono mt-2">Open questions</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block">
              Ask these on the screening call.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground">
              Clarify these before the call
            </h2>

            <div className="mt-5">
              <ul className="divide-y divide-border border-y border-border">
                {brief.rankedUnknowns.map((item: any, idx: number) => {
                  const isChecked = !!checkedUnknowns[idx];
                  return (
                    <li
                      key={idx}
                      onClick={() => toggleCheck(idx)}
                      className="flex items-start gap-3 py-4 cursor-pointer hover:bg-muted/10 transition-colors"
                    >
                      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[2px] border border-border-strong text-xs font-bold text-foreground">
                        {isChecked ? "✓" : ""}
                      </span>
                      <span className={`text-sm leading-relaxed ${isChecked ? "line-through text-muted-foreground" : "text-foreground font-medium"}`}>
                        {item.question}
                      </span>
                      <span className="label-mono ml-auto hidden shrink-0 sm:block font-bold">
                        Q{idx + 1}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 7: DECISION BOUNDARIES (CHAPTER VII)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong">VII</p>
            <p className="label-mono mt-2">Decision boundaries</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block">
              The conditions that flip the call.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground">
              What would change this decision?
            </h2>

            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div className="border-l-2 border-signal pl-4">
                <p className="label-mono text-signal font-bold">This becomes a strong pursue if</p>
                <ul className="mt-2.5 space-y-2.5">
                  {brief.decisionSensitivity.becomesPursueIf.map((cond: string, i: number) => (
                    <li key={i} className="text-sm leading-relaxed text-foreground">
                      {cond}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-l-2 border-destructive pl-4">
                <p className="label-mono text-destructive font-bold">This becomes a pass if</p>
                <ul className="mt-2.5 space-y-2.5">
                  {brief.decisionSensitivity.becomesPassIf.map((cond: string, i: number) => (
                    <li key={i} className="text-sm leading-relaxed text-foreground">
                      {cond}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 8: SUPPORTING EVIDENCE (CHAPTER VIII)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong">VIII</p>
            <p className="label-mono mt-2">Supporting evidence</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block">
              What the posting actually says.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground">
              Evidence behind this recommendation
            </h2>

            <div className="mt-5">
              <p className="label-mono text-signal font-bold">
                Explicit evidence ({strongEvidenceDimensions.length})
              </p>
              <dl className="mt-3 divide-y divide-border border-y border-border">
                {strongEvidenceDimensions.map((dim: any, idx: number) => (
                  <div key={idx} className="flex items-baseline justify-between gap-4 py-3">
                    <dt className="label-mono font-bold text-foreground">{dim.label}</dt>
                    <dd className="text-right font-mono text-xs text-foreground font-medium">
                      {formatValue(dim.jdEvidence.value)}
                    </dd>
                  </div>
                ))}
              </dl>

              {partialEvidenceDimensions.length > 0 && (
                <>
                  <p className="label-mono mt-7 text-caution font-bold">
                    Partial / inferred evidence ({partialEvidenceDimensions.length})
                  </p>
                  <dl className="mt-3 divide-y divide-dashed divide-border border-y border-dashed border-border">
                    {partialEvidenceDimensions.map((dim: any, idx: number) => (
                      <div key={idx} className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                        <dt className="label-mono font-bold text-foreground">{dim.label}</dt>
                        <dd className="text-sm leading-relaxed text-muted-foreground">
                          {formatValue(dim.jdEvidence.value)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              )}
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 9: DOSSIER LEDGER (CHAPTER IX)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong">IX</p>
            <p className="label-mono mt-2">Dossier ledger</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block">
              Claims used to build the score.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground">
              Experience & claims inventory
            </h2>

            <div className="mt-5">
              <ul className="divide-y divide-border border-y border-border">
                {candidateProfile.experience.achievements.slice(0, 5).map((achievement: string, idx: number) => (
                  <li key={idx} className="grid gap-2 py-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-4">
                    <span className="label-mono font-bold text-foreground">R{idx + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm leading-relaxed text-foreground">{achievement}</p>
                      <p className="label-mono mt-1.5 truncate">
                        Transferability · Performance Marketing → GTM Strategy
                      </p>
                    </div>
                    <span className="label-mono self-start text-signal font-bold">✓ Verified</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            FOOTER SUMMARY & NEXT BRIEF NAV
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="flex flex-wrap items-end justify-between gap-4 border-t border-border pt-6">
          <p className="label-mono">
            Generated {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · {brief.evidenceQuality} · {allVerifiedCount} verified signals
          </p>
          {neighbors.next ? (
            <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.next.jobHash }} className="text-right group">
              <span className="label-mono block text-muted-foreground group-hover:text-foreground">Next brief</span>
              <span className="font-display text-xl text-foreground group-hover:underline">{neighbors.next.role} →</span>
            </Link>
          ) : null}
        </section>
      </main>

      {/* ────────────────────────────────────────────────────────────────────────
          FIXED STICKY BOTTOM DECISION ACTION BAR
          ──────────────────────────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1180px] items-center gap-2 px-5 py-2.5 sm:px-8">
          <span className="label-mono mr-auto hidden sm:block font-bold">
            Decide · brief {o.jobHash}
          </span>

          <button
            type="button"
            onClick={() => decide("PURSUE")}
            className={`flex-1 rounded-[4px] px-3 py-2.5 label-mono uppercase font-bold sm:flex-none sm:px-5 transition-colors cursor-pointer ${
              currentVerdict === "PURSUE"
                ? "bg-signal text-signal-foreground"
                : "border border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            Pursue
          </button>

          <button
            type="button"
            onClick={() => decide("CONSIDER")}
            className={`flex-1 rounded-[4px] px-3 py-2.5 label-mono uppercase font-bold sm:flex-none sm:px-5 transition-colors cursor-pointer ${
              currentVerdict === "CONSIDER"
                ? "bg-caution text-caution-foreground"
                : "border border-caution/50 text-caution"
            }`}
          >
            Consider
          </button>

          <button
            type="button"
            onClick={() => decide("PASS")}
            className={`flex-1 rounded-[4px] px-3 py-2.5 label-mono uppercase font-bold sm:flex-none sm:px-5 transition-colors cursor-pointer ${
              currentVerdict === "PASS"
                ? "bg-muted-foreground text-background"
                : "border border-border text-muted-foreground"
            }`}
          >
            Pass
          </button>

          <a
            href={applyUrlFor(o)}
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-[4px] bg-foreground px-5 py-2.5 label-mono text-background font-bold uppercase sm:block hover:opacity-90 transition-opacity"
          >
            Apply ↗
          </a>
        </div>
      </div>
    </div>
  );
}
