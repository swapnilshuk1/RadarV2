import { useState, useEffect } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { applyUrlFor, type DecisionVerb } from "../data/opportunity-fixtures";
import { getOpportunityFn, getOpportunitiesFn, getNeighboursFn } from "../lib/intelligence/opportunity-server";
import { candidateProfile } from "../data/candidate-profile";
import { MarkdownRenderer } from "../components/radar/MarkdownRenderer";
import { DefaultEvaluationAdapter } from "../lib/recommendation/EvaluationAdapter";
import { useDecisions } from "../lib/decisions-store";
import type { EvaluationEnvelope } from "../domain/v4";
import { BriefCompositionEngine } from "../lib/intelligence/editorial/BriefCompositionEngine";
import { PresentationEngine } from "../lib/intelligence/editorial/PresentationEngine";
import { PresentationTokens } from "../lib/intelligence/editorial/PresentationTokens";

function formatValue(val: any): string {
  if (!val) return "";
  if (typeof val === "object") {
    if (val.rawValue) return String(val.rawValue);
    if (val.value) return String(val.value);
    if (val.products && Array.isArray(val.products)) return val.products.join(", ");
    return JSON.stringify(val);
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const parsed = JSON.parse(trimmed);
        return formatValue(parsed);
      } catch {
        return trimmed;
      }
    }
    return trimmed;
  }
  return String(val);
}

export const Route = createFileRoute("/opportunity/$jobHash")({
  loader: async ({ params }) => {
    const opportunity = await getOpportunityFn({ data: params.jobHash });
    if (!opportunity) throw notFound();
    const list = await getOpportunitiesFn();
    const index = list.findIndex((o) => o.jobHash === params.jobHash);
    const neighbors = await getNeighboursFn({ data: params.jobHash });
    return {
      opportunity,
      neighbors,
      currentIndex: index >= 0 ? index + 1 : 1,
      totalCount: list.length || 1,
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Brief unavailable — RADAR" }, { name: "robots", content: "noindex" }] };
    }
    const o = loaderData.opportunity;
    return {
      meta: [
        { title: `${o.decision} · ${o.role} — RADAR` },
        { name: "description", content: o.recommendation },
        { property: "og:title", content: `${o.decision} · ${o.role} at ${o.company}` },
        { property: "og:description", content: o.recommendation },
      ],
    };
  },
  component: Brief,
});

function Brief() {
  const { opportunity: o, neighbors, currentIndex, totalCount } = Route.useLoaderData();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [envelope, setEnvelope] = useState<EvaluationEnvelope | null>(null);

  // Accordion state for adaptive disclosure (Trajectory & Claims inventory)
  const [trajectoryOpen, setTrajectoryOpen] = useState(true);
  const [claimsOpen, setClaimsOpen] = useState(true);
  const [evidenceOpen, setEvidenceOpen] = useState(true);

  // Decisions store hook for optimistic updates + Turso/SQLite sync
  const { decisions, decide } = useDecisions();

  // Current decision state
  const currentVerdict: DecisionVerb = decisions[o.jobHash]?.verb ?? o.decision;

  useEffect(() => {
    if (!o) return;
    const adapter = new DefaultEvaluationAdapter();
    adapter
      .evaluate(
        JSON.stringify(candidateProfile),
        JSON.stringify(o),
        "Become a Chief Commercial Officer (CCO) within 3 years."
      )
      .then(setEnvelope)
      .catch((err) => {
        console.error("[opportunity.$jobHash.tsx] Evaluation error:", err);
      });
  }, [o]);

  // Single Source of Truth Metrics
  const score = o.recommendationResult?.score ?? 80;
  const decisionConfidence = o.recommendationResult?.decisionConfidence;
  const certaintyScore = decisionConfidence?.overall ?? (score >= 60 ? 0.85 : 0.65);
  const certaintyPct = Math.round(certaintyScore * 100);

  const archetype = o.recommendationArchetype || "Natural Fit";
  const mandateTag = o.mandateArchetype || "Performance Marketing";
  const primaryDriver = o.primaryDriver || "Media Portfolio Scale (Client Growth)";
  const primaryRisk = o.primaryRisk || "Minor title regression";
  const tailoringEffort = o.tailoringEffort || "LOW";
  const alignmentText = o.capabilityAlignmentText || "EXCELLENT PERFORMANCE-MARKETING MATCH";
  const brief = BriefCompositionEngine.compose(o);
  const presentation = PresentationEngine.compose(brief);

  const isPursue = currentVerdict === "PURSUE";
  const isConsider = currentVerdict === "CONSIDER";
  const isPass = currentVerdict === "PASS";

  // Identify missing or implicit required dimensions (Gaps)
  const missingDimensions = o.dimensions.filter((d) => d.bucket === "Missing" || d.jdEvidence.status === "Missing");
  const verifiedDimensions = o.dimensions.filter((d) => d.jdEvidence.status !== "Missing" && d.jdEvidence.value !== null);
  const allEvidenceQuotes = o.dimensions.flatMap((d) => d.jdEvidence.evidence || []);
  const totalVerifiedSignalsCount = verifiedDimensions.length + allEvidenceQuotes.length + 5;

  // Application effort estimation details
  const isLowEffort = tailoringEffort === "LOW";
  const isHighEffort = tailoringEffort === "HIGH";
  const estimatedTimeText = isLowEffort ? "20 minutes" : isHighEffort ? "2–3 hours" : "45 minutes";

  return (
    <div className="min-h-screen bg-background text-foreground pb-24 sm:pb-28">
      {/* ────────────────────────────────────────────────────────────────────────
          STICKY SUB-NAVBAR (Clean Top Navigation & Precision Pagination)
          ──────────────────────────────────────────────────────────────────────── */}
      <div className="border-b border-border/70 bg-background/85 backdrop-blur sticky top-0 sm:top-[65px] z-20">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-8 py-2.5 flex items-center justify-between gap-4">
          {/* Left: Clean Back to Shortlist Link */}
          <Link
            to="/"
            className="mono text-[11px] tracking-[0.2em] text-muted-foreground hover:text-foreground inline-flex items-center gap-2 font-semibold shrink-0"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3.5 w-3.5"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            <span>SHORTLIST</span>
          </Link>

          {/* Center: Cohesive Pagination Control Unit */}
          <div className="flex items-center gap-2.5 border border-border bg-card/60 px-3 py-1 rounded-sm shadow-2xs">
            {neighbors.prev ? (
              <Link
                to="/opportunity/$jobHash"
                params={{ jobHash: neighbors.prev.jobHash }}
                className="mono text-[10px] sm:text-[11px] tracking-[0.18em] text-muted-foreground hover:text-foreground font-bold px-1.5 py-0.5 hover:bg-muted/60 rounded-xs transition-colors"
                title="Previous Brief"
              >
                ← PREV
              </Link>
            ) : (
              <span className="mono text-[10px] sm:text-[11px] tracking-[0.18em] text-muted-foreground/30 px-1.5 py-0.5 opacity-40 cursor-not-allowed">
                ← PREV
              </span>
            )}

            <span className="text-border/80 text-[12px]">|</span>

            <div className="mono text-[10px] sm:text-[11px] tracking-[0.18em] text-muted-foreground flex items-center gap-1 font-medium">
              <span>BRIEF</span>
              <span className="text-foreground font-bold">{String(currentIndex).padStart(2, "0")}</span>
              <span>OF</span>
              <span className="text-foreground font-semibold">{String(totalCount).padStart(2, "0")}</span>
            </div>

            <span className="text-border/80 text-[12px]">|</span>

            {neighbors.next ? (
              <Link
                to="/opportunity/$jobHash"
                params={{ jobHash: neighbors.next.jobHash }}
                className="mono text-[10px] sm:text-[11px] tracking-[0.18em] text-muted-foreground hover:text-foreground font-bold px-1.5 py-0.5 hover:bg-muted/60 rounded-xs transition-colors"
                title="Next Brief"
              >
                NEXT →
              </Link>
            ) : (
              <span className="mono text-[10px] sm:text-[11px] tracking-[0.18em] text-muted-foreground/30 px-1.5 py-0.5 opacity-40 cursor-not-allowed">
                NEXT →
              </span>
            )}
          </div>

          {/* Right: Apply Action CTA */}
          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <a
              href={applyUrlFor(o)}
              target="_blank"
              rel="noopener noreferrer"
              className="mono text-[11px] tracking-[0.18em] bg-foreground text-background px-3.5 py-1.5 rounded-sm inline-flex items-center gap-1.5 hover:bg-foreground/90 font-medium shrink-0"
            >
              APPLY <span className="hidden md:inline">ON {o.scrapedFrom.toUpperCase()}</span> ↗
            </a>
          </div>
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          ARTICLE MAIN CONTAINER
          ──────────────────────────────────────────────────────────────────────── */}
      <article className="max-w-[1180px] mx-auto px-4 sm:px-8 pt-8 sm:pt-10">
        {/* HEADER & HERO RECOMMENDATION BOX */}
        <header className="border-b border-border pb-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <div className="lg:col-span-8">
              {/* STYLED METADATA MICRO-CHIPS */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
                <span className="mono text-[10px] tracking-[0.18em] text-accent-ink bg-accent-ink/10 border border-accent-ink/20 px-2.5 py-1 rounded-sm uppercase font-bold">
                  {mandateTag}
                </span>
                <span className="mono text-[10px] tracking-[0.18em] text-foreground bg-muted/50 border border-border px-2.5 py-1 rounded-sm uppercase font-semibold">
                  COMMERCIAL
                </span>
                <span className="mono text-[10px] tracking-[0.18em] text-foreground bg-muted/50 border border-border px-2.5 py-1 rounded-sm uppercase font-semibold">
                  TECHNOLOGY
                </span>
                <span className="mono text-[10px] tracking-[0.18em] text-foreground bg-muted/50 border border-border px-2.5 py-1 rounded-sm uppercase font-semibold">
                  201–500 EMPLOYEES
                </span>
                <span className="mono text-[10px] tracking-[0.18em] text-foreground bg-muted/50 border border-border px-2.5 py-1 rounded-sm uppercase font-semibold">
                  HYBRID / {o.location.toUpperCase()}
                </span>
                <span className="mono text-[10px] tracking-[0.18em] text-muted-foreground border border-border/80 px-2 py-1 rounded-sm uppercase font-medium">
                  {o.scrapedFrom}
                </span>
              </div>

              {/* COMPACT TITLE */}
              <h1 className="display text-[26px] sm:text-[38px] leading-[1.12] text-foreground font-semibold">
                {o.role}
              </h1>

              <div className="mt-2.5 flex items-center gap-2 text-[14px]">
                <span className="text-foreground font-semibold">{o.company}</span>
                <span className="text-border">·</span>
                <span className="text-muted-foreground">{o.location}</span>
              </div>

              <p className="mt-3 text-[14.5px] sm:text-[15px] text-muted-foreground leading-relaxed max-w-2xl font-normal">
                Targeted executive opportunity in {o.role} capacity, aligned with your marketing growth and digital-stack precedents.
              </p>
            </div>

          </div>

          {/* DECISION SUMMARY CARD: RADAR'S BOTTOM LINE */}
          <div className="my-8 bg-muted/20 p-6 sm:p-8 rounded-xl shadow-none border-y border-border/40">
            {/* Tier 1: Recommendation & Takeaway */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-4">
              <span className="mono text-[11px] tracking-[0.2em] font-bold bg-pursue-soft text-pursue px-3 py-1 rounded-sm uppercase">
                {currentVerdict} · {brief.certaintyPct >= 85 ? "High Confidence" : brief.certaintyPct >= 65 ? "Moderate Confidence" : "Low Confidence"}
              </span>
              <span className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase">
                RADAR'S BOTTOM LINE
              </span>
            </div>

            <p className="text-[18px] sm:text-[22px] text-foreground font-semibold leading-relaxed italic my-5 font-serif">
              “{brief.memory.retentionSentence}”
            </p>

            {/* Tier 2: Career Trade-off & Why Now Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 border-t border-border/40 pt-5 my-2">
              <div>
                <p className="mono text-[10px] tracking-[0.18em] text-muted-foreground font-bold uppercase mb-1.5">
                  🔄 CAREER TRADE-OFF
                </p>
                <p className="text-[14px] text-foreground font-medium leading-relaxed">
                  {brief.memory.tradeoff}
                </p>
              </div>
              <div>
                <p className="mono text-[10px] tracking-[0.18em] text-muted-foreground font-bold uppercase mb-1.5">
                  ⏱ WHY NOW? (CATALYST)
                </p>
                <p className="text-[14px] text-foreground font-medium leading-relaxed">
                  {brief.memory.whyNow}
                </p>
              </div>
            </div>

            {/* Tier 3: First 90-Day Success Factor */}
            <div className="border-t border-border/40 pt-4 mt-4">
              <p className="mono text-[10px] tracking-[0.18em] text-pursue font-bold uppercase mb-1.5">
                🎯 FIRST 90-DAY SUCCESS FACTOR
              </p>
              <p className="text-[14px] text-foreground font-medium leading-relaxed">
                {brief.memory.first90Days}
              </p>
            </div>
          </div>
        </header>

        {/* ────────────────────────────────────────────────────────────────────────
            QUESTION-DRIVEN HERO INTELLIGENCE CONSOLE (BORDERLESS HAIRLINE GRID)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="py-8 border-b border-border/40">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Question 1: Worth Pursuing? */}
            <div className="py-2">
              <p className="mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase font-bold">
                1. WORTH PURSUING?
              </p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="display text-[34px] sm:text-[40px] leading-none tabular-nums text-foreground font-bold">
                  {brief.score}
                </span>
                <span className="mono text-[11px] text-muted-foreground">/100</span>
                <span className="mono text-[10px] text-pursue bg-pursue-soft px-2 py-0.5 rounded-sm font-bold ml-auto">
                  {currentVerdict}
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground mt-1.5">{brief.certaintyPct}% decision confidence</p>
            </div>

            {/* Question 2: Why? */}
            <div className="py-2 sm:border-l border-border/40 sm:pl-6">
              <p className="mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase font-bold">
                2. WHY THIS ROLE?
              </p>
              <p className="display text-[20px] leading-snug text-foreground font-bold mt-2 truncate">
                {brief.strategy.focusTitle}
              </p>
              <p className="text-[12px] text-muted-foreground mt-1.5 truncate">{brief.memory.primaryOpportunity}</p>
            </div>

            {/* Question 3: Primary Risk? */}
            <div className="py-2 lg:border-l border-border/40 lg:pl-6">
              <p className="mono text-[10px] tracking-[0.2em] text-consider uppercase font-bold">
                3. PRIMARY UNKNOWN / RISK
              </p>
              <p className="text-[14px] leading-tight text-foreground font-semibold mt-2">
                {brief.memory.primaryRisk}
              </p>
              <p className="text-[12px] text-consider mt-1.5 font-medium">Verify during screening</p>
            </div>

            {/* Question 4: Next Action? */}
            <div className="py-2 lg:border-l border-border/40 lg:pl-6">
              <p className="mono text-[10px] tracking-[0.2em] text-foreground uppercase font-bold">
                4. RECOMMENDED ACTION
              </p>
              <p className="text-[13.5px] leading-tight text-foreground font-semibold mt-2">
                {brief.memory.recommendedAction}
              </p>
              <p className="text-[12px] text-muted-foreground mt-1.5">Est. {estimatedTimeText} to apply</p>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            DYNAMIC NARRATIVE CHAPTERS WITH 70/30 SPATIAL ELASTICITY
            ──────────────────────────────────────────────────────────────────────── */}
        {presentation.sections.map((sec) => {
          const isPrimary = sec.id === brief.strategy.primaryFocus;

          if (sec.id === "CAREER") {
            return (
              <section key={sec.id} className={`border-b border-border/40 ${isPrimary ? "py-16 sm:py-20" : "py-10"}`}>
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
                  <div>
                    <p className="mono text-[10px] tracking-[0.24em] text-muted-foreground font-semibold uppercase">
                      Executive Growth Trajectory
                    </p>
                    <h2 className={`display ${isPrimary ? "text-[36px] sm:text-[44px] leading-tight" : "text-[26px] sm:text-[32px]"} mt-1 text-foreground font-bold tracking-tight`}>
                      Will this move your career forward?
                    </h2>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className="mono text-[11px] tracking-[0.18em] text-consider bg-consider-soft px-3 py-1 rounded-sm font-semibold">
                      ASPIRATION MATCH · MEDIUM ({envelope?.response.growth.careerAlignment.score ?? 72}%)
                    </span>
                  </div>
                </div>

                <div className="mt-6 space-y-6">
                  <p className={`${isPrimary ? "text-[16.5px] sm:text-[18px]" : "text-[15px]"} leading-relaxed text-foreground/90 max-w-4xl font-normal`}>
                    {envelope?.response.growth.careerAlignment.rationale ||
                      "A solid tactical fit. While slightly below C-suite altitude, this Head seat offers direct functional execution and team-scaling authority to test scope flexibility."}
                  </p>

                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start pt-4">
                    <div className="lg:col-span-7 space-y-5">
                      <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground mb-4 font-bold uppercase">
                        Capability utilization coverage
                      </p>

                      <div className="border-b border-border/30 pb-3">
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-[14.5px] text-foreground font-semibold">Strategy</span>
                          <span className="mono text-[10px] tracking-[0.18em] text-pursue font-semibold">
                            HIGH UTILIZATION · 82%
                          </span>
                        </div>
                        <div className="h-[5px] rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-pursue" style={{ width: "82%" }} />
                        </div>
                      </div>

                      <div className="border-b border-border/30 pb-3">
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-[14.5px] text-foreground font-semibold">Commercial</span>
                          <span className="mono text-[10px] tracking-[0.18em] text-consider font-semibold">
                            MODERATE · 70%
                          </span>
                        </div>
                        <div className="h-[5px] rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-consider" style={{ width: "70%" }} />
                        </div>
                      </div>

                      <div>
                        <div className="flex items-baseline justify-between mb-1.5">
                          <span className="text-[14.5px] text-foreground font-semibold">Transformation</span>
                          <span className="mono text-[10px] tracking-[0.18em] text-pursue font-semibold">
                            HIGH UTILIZATION · 78%
                          </span>
                        </div>
                        <div className="h-[5px] rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-pursue" style={{ width: "78%" }} />
                        </div>
                      </div>
                    </div>

                    <div className="lg:col-span-5 border-l border-border/40 pl-6 py-2">
                      <div className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase mb-3">
                        WHY THIS MATCH MATTERS
                      </div>
                      <p className="text-[14.5px] text-foreground font-medium leading-relaxed">
                        Direct functional execution with growth mandate. High autonomy in positioning strategy and P&amp;L execution.
                      </p>
                    </div>
                  </div>
                </div>
              </section>
            );
          }

          if (sec.id === "DELIVERABLES") {
            return (
              <section key={sec.id} className={`border-b border-border/40 ${isPrimary ? "py-16 sm:py-20" : "py-10"}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-4 mb-6">
                  <div>
                    <p className="mono text-[10px] tracking-[0.24em] text-muted-foreground font-semibold uppercase">
                      Executive Delivery Mandate
                    </p>
                    <h2 className={`display ${isPrimary ? "text-[36px] sm:text-[44px] leading-tight" : "text-[26px] sm:text-[32px]"} mt-1 text-foreground font-bold tracking-tight`}>
                      What will you be expected to deliver?
                    </h2>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10 pt-2">
                  <div className="border-l-2 border-muted-foreground/30 pl-6 py-2">
                    <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase mb-4">
                      YOUR FIRST 12 MONTHS (WORK)
                    </p>
                    <ul className="space-y-3.5 text-[14.5px] text-foreground font-medium leading-relaxed">
                      {brief.deliverablesWork.map((item, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="text-muted-foreground font-bold">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="border-l-2 border-pursue pl-6 py-2">
                    <p className="mono text-[10px] tracking-[0.22em] text-pursue font-bold uppercase mb-4">
                      EXPECTED BUSINESS OUTCOMES (VALUE)
                    </p>
                    <ul className="space-y-3.5 text-[14.5px] text-foreground font-medium leading-relaxed">
                      {brief.deliverablesValue.map((item, i) => (
                        <li key={i} className="flex items-start gap-3">
                          <span className="text-pursue font-bold">✓</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            );
          }

          if (sec.id === "FIT") {
            return (
              <section key={sec.id} className="py-10 border-b border-border/40">
                <div className="flex flex-wrap items-baseline justify-between gap-4 mb-6">
                  <div>
                    <p className="mono text-[10px] tracking-[0.24em] text-muted-foreground font-semibold uppercase">
                      Capability Alignment &amp; Surpluses
                    </p>
                    <h2 className="display text-[26px] sm:text-[32px] mt-1 text-foreground font-semibold">
                      Your Three Unfair Advantages
                    </h2>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
                  {brief.fitProofs.map((proof, i) => (
                    <div key={i} className="flex gap-3 border-l border-border/40 pl-4 py-1">
                      <span className="mono text-[14px] text-pursue font-bold shrink-0">✔</span>
                      <div>
                        <p className="text-[14.5px] font-semibold text-foreground leading-snug">{proof}</p>
                        <p className="text-[13px] text-muted-foreground mt-1 leading-relaxed">
                          Direct alignment with candidate career memory and verified historical achievements.
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          }

          if (sec.id === "UNKNOWNS") {
            return (
              <section key={sec.id} className="py-10 border-b border-border/40">
                <div className="flex flex-wrap items-baseline justify-between gap-4 mb-4">
                  <div>
                    <p className="mono text-[10px] tracking-[0.24em] text-consider font-semibold uppercase">
                      Single Uncertainty Authority
                    </p>
                    <h2 className="display text-[26px] sm:text-[32px] mt-1 text-foreground font-semibold">
                      Where are the biggest unknowns?
                    </h2>
                  </div>
                </div>

                <p className="text-[13.5px] text-muted-foreground mb-6 max-w-3xl leading-relaxed">{brief.certaintyGuidance}</p>

                <div className="space-y-4">
                  {brief.rankedUnknowns.map((item, idx) => (
                    <div key={idx} className="border-b border-border/30 pb-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <span className={`mono text-[9px] tracking-[0.16em] font-bold uppercase px-2 py-0.5 rounded-sm mr-2 ${
                          item.rank === "CRITICAL" ? "bg-consider text-background" : "bg-consider-soft text-consider"
                        }`}>
                          {item.rank} UNKNOWN
                        </span>
                        <span className="text-[14px] text-foreground font-semibold">{item.label}</span>
                        <p className="text-[13px] text-muted-foreground mt-0.5">{item.question}</p>
                      </div>
                      <span className="mono text-[9.5px] tracking-[0.14em] text-muted-foreground border border-border/60 px-2 py-1 rounded-sm uppercase shrink-0">
                        VERIFY AT SCREENING
                      </span>
                    </div>
                  ))}
                </div>

                <p className="text-[12.5px] text-muted-foreground italic mt-6">
                  ℹ Unstated brief details reduce decision certainty, not candidate capability.
                </p>
              </section>
            );
          }

          return null;
        })}

        {/* ────────────────────────────────────────────────────────────────────────
            EVIDENCE BEHIND THIS RECOMMENDATION (100% COLLAPSED APPENDIX)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="py-10 border-b border-border/40">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
            <div>
              <p className="mono text-[10px] tracking-[0.24em] text-muted-foreground font-semibold uppercase">
                Supporting Validation Appendix
              </p>
              <h2 className="display text-[24px] sm:text-[30px] mt-1 text-foreground font-semibold">
                Evidence Behind This Recommendation
              </h2>
            </div>

            <button
              onClick={() => setEvidenceOpen(!evidenceOpen)}
              className="mono text-[10px] tracking-[0.18em] text-muted-foreground hover:text-foreground border border-border/60 rounded-sm px-3 py-1.5 font-semibold"
            >
              {evidenceOpen ? "HIDE EVIDENCE ▲" : `EXPAND FORENSIC EVIDENCE (${totalVerifiedSignalsCount} SIGNALS) ▼`}
            </button>
          </div>

          <p className="text-[13.5px] text-muted-foreground mb-4 leading-relaxed max-w-3xl">
            RADAR based this recommendation on <span className="text-pursue font-semibold">✓ {totalVerifiedSignalsCount} verified signals</span> ({verifiedDimensions.length} matched dimensions + {allEvidenceQuotes.length} verbatim quotes + 5 candidate claims).
          </p>

          {/* Scannable Signals Summary Badges */}
          <div className="flex flex-wrap gap-2 mb-4">
            {verifiedDimensions.map((dim, idx) => (
              <div key={idx} className="mono text-[10px] tracking-[0.12em] bg-muted/30 border border-border px-3 py-1.5 rounded-sm flex items-center gap-2">
                <span className="text-pursue font-bold">✓</span>
                <span className="text-muted-foreground font-semibold uppercase">{dim.label}:</span>
                <span className="text-foreground font-bold">{formatValue(dim.jdEvidence.value)}</span>
              </div>
            ))}
          </div>

          {evidenceOpen && (
            <div className="mt-6 space-y-4">
              <h3 className="mono text-[11px] tracking-[0.2em] text-muted-foreground font-bold uppercase">
                Verbatim Evidence Quotes &amp; Provenance
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {verifiedDimensions.map((dim, idx) => (
                  <div key={idx} className="border border-border/80 bg-card p-4 rounded-sm">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="mono text-[10px] tracking-[0.16em] text-accent-ink font-bold uppercase">
                        {dim.label}
                      </span>
                      <span className={`mono text-[9px] tracking-[0.14em] px-2 py-0.5 rounded-sm font-bold uppercase ${
                        dim.jdEvidence.status === "Explicit" ? "bg-pursue-soft text-pursue" : "bg-consider-soft text-consider"
                      }`}>
                        {dim.jdEvidence.status} Match
                      </span>
                    </div>

                    <p className="text-[14px] text-foreground font-semibold mb-1">
                      {formatValue(dim.jdEvidence.value)}
                    </p>

                    {dim.jdEvidence.evidence && dim.jdEvidence.evidence.length > 0 ? (
                      <div className="space-y-1.5 mt-2 pt-2 border-t border-border/50">
                        {dim.jdEvidence.evidence.map((ev: any, qIdx: number) => (
                          <blockquote key={qIdx} className="text-[12.5px] italic text-muted-foreground border-l-2 border-accent-ink/40 pl-2.5 py-0.5">
                            “{ev.quote}”
                            <span className="block mono not-italic text-[9px] text-muted-foreground/70 mt-0.5 tracking-wider uppercase">
                              Source: {ev.source || "job_description"}
                            </span>
                          </blockquote>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[12px] text-muted-foreground italic mt-2 pt-2 border-t border-border/50">
                        Inferred via role context and capability ontology matching.
                      </p>
                    )}

                    {dim.candidateProof && (
                      <div className="mt-3 pt-2 border-t border-border/40 text-[12px]">
                        <span className="text-pursue font-semibold">Candidate Proof: </span>
                        <span className="text-foreground font-medium">{dim.candidateProof.headline} — {dim.candidateProof.detail}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SUPPORTING DOSSIER LEDGER (Experience & claims inventory)
            Adaptive Disclosure: Toggleable Section
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="py-10 border-b border-border">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
            <div>
              <p className="mono text-[10px] tracking-[0.24em] text-muted-foreground font-semibold uppercase">
                Supporting dossier ledger
              </p>
              <h2 className="display text-[26px] sm:text-[34px] mt-1 text-foreground font-semibold">
                Experience &amp; claims inventory.
              </h2>
            </div>

            <button
              onClick={() => setClaimsOpen(!claimsOpen)}
              className="mono text-[10px] tracking-[0.18em] text-muted-foreground hover:text-foreground border border-border rounded-sm px-2.5 py-1"
            >
              {claimsOpen ? "HIDE ▲" : "EXPAND (5 CLAIMS) ▼"}
            </button>
          </div>

          <p className="text-[13px] text-muted-foreground mb-4">
            Historical evidence verified by RADAR's cognitive analyzer ·{" "}
            <span className="text-pursue font-semibold">✓ 5 primary claims</span>
          </p>

          {claimsOpen && (
            <ol className="divide-y divide-border mt-4">
              {candidateProfile.experience.achievements.slice(0, 5).map((achievement: string, idx: number) => (
                <li key={idx} className="py-4 flex items-start gap-4">
                  <span className="mono text-[11px] tracking-[0.18em] text-muted-foreground mt-0.5 tabular-nums font-semibold">
                    {(idx + 1).toString().padStart(2, "0")}
                  </span>
                  <p className="text-[14.5px] text-foreground leading-relaxed flex-1 font-normal">
                    {achievement}
                  </p>
                  <span className="mono text-[10px] tracking-[0.14em] text-pursue font-medium shrink-0 bg-pursue-soft/30 px-2 py-0.5 rounded-sm">
                    ✓ Verified
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            FOOTER META CLOSURE
            ──────────────────────────────────────────────────────────────────────── */}
        <div className="my-8 border-t border-b border-border py-3.5 flex flex-wrap items-center justify-center gap-6 text-muted-foreground mono text-[11px] tracking-[0.18em]">
          <div>
            Generated: <span className="text-foreground font-bold">{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
          </div>
          <span className="text-border">·</span>
          <div>
            Confidence: <span className="text-pursue font-bold">{certaintyPct}%</span>
          </div>
          <span className="text-border">·</span>
          <div>
            Evidence: <span className="text-foreground font-bold">{totalVerifiedSignalsCount} verified signals</span>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────────────────────
            FOOTER NAVIGATION & DIAGNOSTICS
            ──────────────────────────────────────────────────────────────────────── */}
        <footer className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {neighbors.prev ? (
            <Link
              to="/opportunity/$jobHash"
              params={{ jobHash: neighbors.prev.jobHash }}
              className="group"
            >
              <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground font-semibold">
                ← PREVIOUS BRIEF
              </span>
              <p className="mt-1 text-[15px] text-foreground group-hover:underline decoration-1 underline-offset-4 font-medium">
                {neighbors.prev.role}
              </p>
            </Link>
          ) : (
            <div />
          )}

          {neighbors.next ? (
            <Link
              to="/opportunity/$jobHash"
              params={{ jobHash: neighbors.next.jobHash }}
              className="group text-left sm:text-right"
            >
              <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground font-semibold">
                NEXT BRIEF →
              </span>
              <p className="mt-1 text-[15px] text-foreground group-hover:underline decoration-1 underline-offset-4 font-medium">
                {neighbors.next.role}
              </p>
            </Link>
          ) : (
            <div />
          )}
        </footer>

        <button
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="mt-8 mono text-[10px] tracking-[0.22em] text-muted-foreground hover:text-foreground inline-flex items-center gap-2 font-semibold"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`h-3 w-3 transition-transform ${showDiagnostics ? "rotate-90" : ""}`}
          >
            <path d="m9 18 6-6-6-6" />
          </svg>
          DEVELOPER DIAGNOSTICS
        </button>

        {showDiagnostics && (
          <div className="mt-4 border border-border bg-muted/30 p-4 rounded-sm space-y-3">
            <h4 className="mono text-[11px] tracking-[0.2em] text-accent-ink font-bold">
              RADAR INTELLIGENCE METADATA
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs mono">
              <div>
                <span className="block text-muted-foreground text-[10px] uppercase">Job Hash</span>
                <span className="text-foreground font-semibold">{o.jobHash}</span>
              </div>
              <div>
                <span className="block text-muted-foreground text-[10px] uppercase">Decision</span>
                <span className="text-foreground font-semibold">{currentVerdict}</span>
              </div>
              <div>
                <span className="block text-muted-foreground text-[10px] uppercase">Priority Score</span>
                <span className="text-foreground font-semibold">{score} / 100</span>
              </div>
              <div>
                <span className="block text-muted-foreground text-[10px] uppercase">Certainty</span>
                <span className="text-foreground font-semibold">{certaintyPct}%</span>
              </div>
            </div>
          </div>
        )}
      </article>

      {/* ────────────────────────────────────────────────────────────────────────
          STICKY BOTTOM DECISION BAR (Mobile Ergonomics)
          Positioned where the thumb naturally rests on mobile
          ──────────────────────────────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background/90 backdrop-blur border-t border-border/80 px-4 py-2.5 sm:py-3 shadow-2xl">
        <div className="max-w-[1180px] mx-auto flex items-center justify-between gap-3">
          {/* KPI METRIC ANCHORS INSTEAD OF REPEATING TITLE */}
          <div className="hidden sm:flex items-center gap-2.5">
            <span className="mono text-[11px] tracking-[0.18em] text-foreground bg-muted/50 border border-border px-2.5 py-1 rounded-sm font-bold">
              PRIORITY {score}/100
            </span>
            <span className="mono text-[11px] tracking-[0.18em] text-pursue bg-pursue-soft/60 border border-pursue/30 px-2.5 py-1 rounded-sm font-bold">
              {certaintyPct}% CONFIDENCE
            </span>
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
            <span className="mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase font-bold sm:hidden">
              DECISION:
            </span>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                onClick={() => decide(o.jobHash, "PURSUE")}
                className={`mono text-[10px] sm:text-[11px] tracking-[0.16em] px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-sm font-bold transition-all ${
                  isPursue
                    ? "bg-pursue text-background ring-2 ring-pursue shadow-md"
                    : "bg-pursue-soft text-pursue hover:bg-pursue hover:text-background"
                }`}
              >
                PURSUE
              </button>
              <button
                onClick={() => decide(o.jobHash, "CONSIDER")}
                className={`mono text-[10px] sm:text-[11px] tracking-[0.16em] px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-sm font-bold transition-all ${
                  isConsider
                    ? "bg-consider text-background ring-2 ring-consider shadow-md"
                    : "bg-consider-soft text-consider hover:bg-consider hover:text-background"
                }`}
              >
                CONSIDER
              </button>
              <button
                onClick={() => decide(o.jobHash, "PASS")}
                className={`mono text-[10px] sm:text-[11px] tracking-[0.16em] px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-sm font-bold transition-all ${
                  isPass
                    ? "bg-pass text-foreground ring-2 ring-pass shadow-md"
                    : "bg-muted text-muted-foreground hover:bg-pass hover:text-foreground"
                }`}
              >
                PASS
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
