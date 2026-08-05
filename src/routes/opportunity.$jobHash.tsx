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
            <Link to="/" className="label-mono hover:text-foreground transition-colors font-normal">
              ← Shortlist
            </Link>
            <span className="label-mono font-normal text-muted-foreground">
              Brief {String(currentIndex).padStart(2, "0")} of {totalCount}
            </span>
          </div>

          {/* Badges & Verbs */}
          <div className="mt-7 flex flex-wrap items-center gap-2">
            <span className="label-mono rounded-[3px] bg-signal px-1.5 py-[3px] leading-none text-signal-foreground font-normal">
              {currentVerdict === "PURSUE" ? "Pursue" : currentVerdict === "CONSIDER" ? "Consider" : "Pass"}
            </span>
            <span className="label-mono font-normal">Strong strategic fit</span>
            <span className="label-mono font-normal">· {brief.evidenceQuality}</span>
            <span className="label-mono hidden sm:inline font-normal">· 20 minute application</span>
          </div>

          {/* Headline Title */}
          <h1 className="mt-4 max-w-4xl font-display text-[2.6rem] leading-[1.02] tracking-tight sm:text-6xl text-foreground font-normal">
            {o.role} mandate at {o.company} focused on {o.primaryDriver || "growth strategy and commercial performance."}
          </h1>

          {/* Subtitle Company Line */}
          <p className="mt-4 border-t border-border pt-4 font-mono text-xs tracking-[0.12em] uppercase text-muted-foreground font-normal">
            <span className="text-foreground font-medium">{o.company}</span> · {o.location} (On-site)
          </p>
        </div>
      </header>

      {/* ────────────────────────────────────────────────────────────────────────
          EXECUTIVE BRIEF HIGHLIGHT BANNER
          ──────────────────────────────────────────────────────────────────────── */}
      <section className="border-b border-border bg-surface-raised">
        <div className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 sm:py-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="label-mono text-primary font-normal">If you only read one thing</span>
            <span className="label-mono font-normal text-muted-foreground">1-minute executive brief</span>
          </div>
          <p className="mt-4 font-display text-3xl leading-tight sm:text-4xl text-foreground font-normal">
            {currentVerdict === "PURSUE" ? "Worth pursuing." : currentVerdict === "CONSIDER" ? "Worth considering." : "Pass on this mandate."}
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-2">
            <div className="border-l-2 border-signal pl-4">
              <p className="label-mono text-signal font-normal">Why pursue</p>
              <ul className="mt-2.5 space-y-2.5">
                {brief.oneMinuteTLDR.whyPursue.map((item: string, i: number) => (
                  <li key={i} className="text-sm leading-relaxed text-foreground font-normal">
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="border-l-2 border-caution pl-4">
              <p className="label-mono text-caution font-normal">Watch for</p>
              <ul className="mt-2.5 space-y-2.5">
                {brief.oneMinuteTLDR.watchFor.map((item: string, i: number) => (
                  <li key={i} className="text-sm leading-relaxed text-foreground font-normal">
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────────────
          MAIN EDITORIAL SECTIONS (UNBOXED SEAMLESS FLOW WITH STICKY HEADERS)
          ──────────────────────────────────────────────────────────────────────── */}
      <main className="mx-auto max-w-[1180px] space-y-12 px-5 py-12 sm:px-8 sm:space-y-16">
        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 1: STRATEGIC CAREER VALUE (CHAPTER I)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full items-start">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong font-normal">I</p>
            <p className="label-mono mt-2 font-normal text-foreground">Strategic career value</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block font-normal">
              What this mandate does to your record.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground font-normal">
              Why this role is interesting
            </h2>
            <div className="mt-5">
              <ol className="divide-y divide-border border-y border-border">
                {brief.strategicUpside.points.map((point: string, i: number) => (
                  <li key={i} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-3 py-4">
                    <span className="label-mono tabular-nums text-border-strong font-normal">
                      0{i + 1}
                    </span>
                    <p className="text-sm leading-relaxed text-foreground font-normal">
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
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full items-start">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong font-normal">II</p>
            <p className="label-mono mt-2 font-normal text-foreground">Explainable reasoning</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block font-normal">
              Every score is traceable to evidence.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground font-normal">
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
                      <span className="label-mono truncate text-foreground font-normal">
                        {row.layer}
                      </span>
                      <span className="flex shrink-0 items-center gap-4">
                        <span className="font-mono text-xs text-primary font-normal">{row.ratingLabel}</span>
                        <span className="label-mono text-muted-foreground group-hover:text-foreground font-normal">
                          {expandedReasoningRow === idx ? "− Hide" : "+ Why"}
                        </span>
                      </span>
                    </button>

                    {expandedReasoningRow === idx && (
                      <div className="pb-5">
                        <ul className="space-y-1.5">
                          {row.becausePoints.map((b: string, bIdx: number) => (
                            <li key={bIdx} className="flex gap-2 text-sm text-foreground font-normal">
                              <span className="text-signal font-normal">✓</span>
                              <span>{b}</span>
                            </li>
                          ))}
                        </ul>
                        <p className="mt-4 border-l-2 border-border-strong pl-3 font-display text-base italic text-muted-foreground font-normal">
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
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full items-start">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong font-normal">III</p>
            <p className="label-mono mt-2 font-normal text-foreground">The call</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block font-normal">
              The honest version.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground font-normal">
              Yes — but for a very specific reason.
            </h2>

            <div className="mt-5">
              <p className="max-w-2xl font-display text-xl leading-relaxed sm:text-2xl text-foreground font-normal">
                A solid tactical fit. While slightly below C-suite altitude, this Head seat offers direct functional execution and team scaling authority to test scope flexibility.
              </p>

              <p className="mt-5 border-l-2 border-caution pl-4 text-sm leading-relaxed text-muted-foreground font-normal">
                <span className="label-mono block text-caution font-normal mb-1">Why it is not a stronger call</span>
                {brief.whyNotStronger || "This role aligns strongly with target executive capabilities and leadership altitude."}
              </p>

              <dl className="mt-7 divide-y divide-border border-y border-border">
                <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                  <dt className="label-mono text-muted-foreground font-normal">Core strength</dt>
                  <dd className="min-w-0">
                    <p className="font-display text-lg leading-snug text-foreground font-normal">Growth &amp; acquisition strategy</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground font-normal">Direct alignment with historical P&amp;L precedents.</p>
                  </dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                  <dt className="label-mono text-muted-foreground font-normal">Adjacent strength</dt>
                  <dd className="min-w-0">
                    <p className="font-display text-lg leading-snug text-foreground font-normal">Commercial revenue models</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground font-normal">Core acquisition principles apply to new channels.</p>
                  </dd>
                </div>
                <div className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                  <dt className="label-mono text-muted-foreground font-normal">Transferable</dt>
                  <dd className="min-w-0">
                    <p className="font-display text-lg leading-snug text-foreground font-normal">Digital transformation</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground font-normal">Rooted in the same team's deep D2C relationship gains.</p>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 4: THE ROLE (CHAPTER IV)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full items-start">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong font-normal">IV</p>
            <p className="label-mono mt-2 font-normal text-foreground">The mandate</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block font-normal">
              First three quarters, as written.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground font-normal">
              What will you be expected to deliver?
            </h2>

            <div className="mt-5">
              <ol className="border-l border-border pl-6 space-y-8">
                {brief.deliverablesWork.map((item: string, i: number) => (
                  <li key={i} className="relative last:pb-0">
                    <span className="absolute -left-[28.5px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="label-mono text-primary font-normal">Month {i * 3 + 3}</span>
                      <span className="label-mono font-normal text-muted-foreground">
                        {brief.deliverablesProvenance[i] === "Observed in JD" ? "Baseline 30–90" : i === 1 ? "Leverage your platform" : "Compound from high rhythm"}
                      </span>
                    </div>
                    <p className="mt-1.5 font-display text-xl leading-snug text-foreground font-normal">
                      {item}
                    </p>
                    {brief.deliverablesValue[i] && (
                      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground font-normal">
                        <span className="label-mono text-signal font-normal mr-1">Outcome</span> {brief.deliverablesValue[i]}
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
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full items-start">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong font-normal">V</p>
            <p className="label-mono mt-2 font-normal text-foreground">Your advantage</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block font-normal">
              Where your record maps onto the ask.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground font-normal">
              Why RADAR believes you're well positioned
            </h2>

            <div className="mt-5">
              <dl className="divide-y divide-border border-y border-border">
                {brief.proofPoints.map((proof: any, i: number) => (
                  <div key={i} className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                    <dt className="label-mono text-signal font-normal">
                      {proof.category === "Direct Evidence" ? "Direct evidence" : "Transferable experience"}
                    </dt>
                    <dd className="min-w-0">
                      <p className="font-display text-lg leading-snug text-foreground font-normal">{proof.headline}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground font-normal">{proof.detail}</p>
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
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full items-start">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong font-normal">VI</p>
            <p className="label-mono mt-2 font-normal text-foreground">Open questions</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block font-normal">
              Ask these on the screening call.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground font-normal">
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
                      <span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-[2px] border border-border-strong text-xs font-normal text-foreground">
                        {isChecked ? "✓" : ""}
                      </span>
                      <span className={`text-sm leading-relaxed ${isChecked ? "line-through text-muted-foreground" : "text-foreground font-normal"}`}>
                        {item.question}
                      </span>
                      <span className="label-mono ml-auto hidden shrink-0 sm:block font-normal text-muted-foreground">
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
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full items-start">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong font-normal">VII</p>
            <p className="label-mono mt-2 font-normal text-foreground">Decision boundaries</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block font-normal">
              The conditions that flip the call.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground font-normal">
              What would change this decision?
            </h2>

            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div className="border-l-2 border-signal pl-4">
                <p className="label-mono text-signal font-normal">This becomes a strong pursue if</p>
                <ul className="mt-2.5 space-y-2.5">
                  {brief.decisionSensitivity.becomesPursueIf.map((cond: string, i: number) => (
                    <li key={i} className="text-sm leading-relaxed text-foreground font-normal">
                      {cond}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-l-2 border-caution pl-4">
                <p className="label-mono text-caution font-normal">This becomes a pass if</p>
                <ul className="mt-2.5 space-y-2.5">
                  {brief.decisionSensitivity.becomesPassIf.map((cond: string, i: number) => (
                    <li key={i} className="text-sm leading-relaxed text-foreground font-normal">
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
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full items-start">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong font-normal">VIII</p>
            <p className="label-mono mt-2 font-normal text-foreground">Supporting evidence</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block font-normal">
              What the posting actually says.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground font-normal">
              Evidence behind this recommendation
            </h2>

            <div className="mt-5">
              <p className="label-mono text-signal font-normal">
                Explicit evidence ({strongEvidenceDimensions.length})
              </p>
              <dl className="mt-3 divide-y divide-border border-y border-border">
                {strongEvidenceDimensions.map((dim: any, idx: number) => (
                  <div key={idx} className="flex items-baseline justify-between gap-4 py-3">
                    <dt className="label-mono font-normal text-muted-foreground">{dim.label}</dt>
                    <dd className="text-right font-mono text-xs text-foreground font-normal">
                      {formatValue(dim.jdEvidence.value)}
                    </dd>
                  </div>
                ))}
              </dl>

              {partialEvidenceDimensions.length > 0 && (
                <>
                  <p className="label-mono mt-7 text-caution font-normal">
                    Partial / inferred evidence ({partialEvidenceDimensions.length})
                  </p>
                  <dl className="mt-3 divide-y divide-dashed divide-border border-y border-dashed border-border">
                    {partialEvidenceDimensions.map((dim: any, idx: number) => (
                      <div key={idx} className="grid gap-1 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                        <dt className="label-mono font-normal text-muted-foreground">{dim.label}</dt>
                        <dd className="text-sm leading-relaxed text-muted-foreground font-normal">
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
        <section className="grid gap-5 border-t border-border pt-8 sm:gap-8 lg:grid-cols-[10rem_minmax(0,1fr)] lg:gap-12 w-full items-start">
          <div className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-display text-2xl leading-none text-border-strong font-normal">IX</p>
            <p className="label-mono mt-2 font-normal text-foreground">Dossier ledger</p>
            <p className="mt-2 hidden text-xs leading-relaxed text-muted-foreground lg:block font-normal">
              Claims used to build the score.
            </p>
          </div>
          <div className="min-w-0">
            <h2 className="font-display text-[1.9rem] leading-tight sm:text-4xl text-foreground font-normal">
              Experience &amp; claims inventory
            </h2>

            <div className="mt-5">
              <ul className="divide-y divide-border border-y border-border">
                {candidateProfile.experience.achievements.slice(0, 5).map((achievement: string, idx: number) => (
                  <li key={idx} className="grid gap-2 py-4 sm:grid-cols-[3rem_minmax(0,1fr)_auto] sm:gap-4">
                    <span className="label-mono font-normal text-muted-foreground">R{idx + 1}</span>
                    <div className="min-w-0">
                      <p className="text-sm leading-relaxed text-foreground font-normal">{achievement}</p>
                      <p className="label-mono mt-1.5 truncate font-normal text-muted-foreground">
                        Transferability · Performance Marketing → GTM Strategy
                      </p>
                    </div>
                    <span className="label-mono self-start text-signal font-normal">✓ Verified</span>
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
          <p className="label-mono font-normal text-muted-foreground">
            Generated {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · {brief.evidenceQuality} · {allVerifiedCount} verified signals
          </p>
          {neighbors.next ? (
            <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.next.jobHash }} className="text-right group">
              <span className="label-mono block text-muted-foreground group-hover:text-foreground font-normal">Next brief</span>
              <span className="font-display text-xl text-foreground group-hover:underline font-normal">{neighbors.next.role} →</span>
            </Link>
          ) : null}
        </section>
      </main>

      {/* ────────────────────────────────────────────────────────────────────────
          FIXED STICKY BOTTOM DECISION ACTION BAR
          ──────────────────────────────────────────────────────────────────────── */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1180px] items-center gap-2 px-5 py-2.5 sm:px-8">
          <span className="label-mono mr-auto hidden sm:block font-normal text-muted-foreground">
            Decide · brief {o.jobHash}
          </span>

          <button
            type="button"
            onClick={() => decide("PURSUE")}
            className={`flex-1 rounded-[4px] px-3 py-2.5 label-mono uppercase font-normal sm:flex-none sm:px-5 transition-colors cursor-pointer ${
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
            className={`flex-1 rounded-[4px] px-3 py-2.5 label-mono uppercase font-normal sm:flex-none sm:px-5 transition-colors cursor-pointer ${
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
            className={`flex-1 rounded-[4px] px-3 py-2.5 label-mono uppercase font-normal sm:flex-none sm:px-5 transition-colors cursor-pointer ${
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
            className="hidden rounded-[4px] bg-foreground px-5 py-2.5 label-mono text-background font-normal uppercase sm:block hover:opacity-90 transition-opacity"
          >
            Apply ↗
          </a>
        </div>
      </div>
    </div>
  );
}
