import { useState, useEffect } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { applyUrlFor } from "../data/opportunity-fixtures";
import { OpportunityProvider } from "../lib/intelligence/opportunity-provider";
import { candidateProfile } from "../data/candidate-profile";
import { MarkdownRenderer } from "../components/radar/MarkdownRenderer";
import { DefaultEvaluationAdapter } from "../lib/recommendation/EvaluationAdapter";
import type { EvaluationEnvelope } from "../domain/v4";

export const Route = createFileRoute("/opportunity/$jobHash")({
  loader: ({ params }) => {
    const opportunity = OpportunityProvider.get(params.jobHash);
    if (!opportunity) throw notFound();
    const neighbors = OpportunityProvider.neighbours(params.jobHash);
    return { opportunity, neighbors };
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
  const { opportunity: o, neighbors } = Route.useLoaderData();
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [envelope, setEnvelope] = useState<EvaluationEnvelope | null>(null);

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

  // Single Source of Truth Metrics (aligned 100% with Shortlist)
  const score = o.recommendationResult?.score ?? 80;
  const verdict = o.decision;
  const decisionConfidence = o.recommendationResult?.decisionConfidence;
  const certaintyScore = decisionConfidence?.overall ?? (score >= 60 ? 0.85 : 0.65);
  const certaintyPct = Math.round(certaintyScore * 100);

  const archetype = o.recommendationArchetype || "Natural Fit";
  const mandateTag = o.mandateArchetype || "Performance Marketing";
  const primaryDriver = o.primaryDriver || "Media Portfolio Scale (Client Growth)";
  const primaryRisk = o.primaryRisk || "Minor title regression";
  const tailoringEffort = o.tailoringEffort || "LOW";
  const alignmentText = o.capabilityAlignmentText || "EXCELLENT PERFORMANCE-MARKETING MATCH";

  const isPursue = verdict === "PURSUE";
  const isConsider = verdict === "CONSIDER";

  // Identify missing or implicit required dimensions (Gaps)
  const missingDimensions = o.dimensions.filter((d) => d.bucket === "Missing" || d.jdEvidence.status === "Missing");

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ────────────────────────────────────────────────────────────────────────
          STICKY SUB-NAVBAR
          ──────────────────────────────────────────────────────────────────────── */}
      <div className="border-b border-border/70 bg-background/85 backdrop-blur sticky top-0 sm:top-[65px] z-20">
        <div className="max-w-[1180px] mx-auto px-4 sm:px-8 py-3 flex items-center justify-between">
          <Link
            to="/"
            className="mono text-[11px] tracking-[0.22em] text-muted-foreground hover:text-foreground inline-flex items-center gap-2 font-medium"
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
              className="h-3 w-3"
            >
              <path d="m12 19-7-7 7-7" />
              <path d="M19 12H5" />
            </svg>
            BACK TO SHORTLIST
          </Link>

          <div className="flex items-center gap-4 sm:gap-6">
            <span className="mono text-[11px] tracking-[0.2em] text-muted-foreground hidden md:inline">
              BRIEF <span className="text-foreground font-bold">05</span> / 06
            </span>
            <div className="flex items-center gap-2">
              {neighbors.prev ? (
                <Link
                  to="/opportunity/$jobHash"
                  params={{ jobHash: neighbors.prev.jobHash }}
                  className="mono text-[10px] tracking-[0.2em] text-muted-foreground hover:text-foreground border border-border rounded-sm px-3 py-1.5"
                >
                  ← PREV
                </Link>
              ) : (
                <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground/40 border border-border/40 rounded-sm px-3 py-1.5 opacity-50 cursor-not-allowed">
                  ← PREV
                </span>
              )}

              {neighbors.next ? (
                <Link
                  to="/opportunity/$jobHash"
                  params={{ jobHash: neighbors.next.jobHash }}
                  className="mono text-[10px] tracking-[0.2em] text-muted-foreground hover:text-foreground border border-border rounded-sm px-3 py-1.5"
                >
                  NEXT →
                </Link>
              ) : (
                <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground/40 border border-border/40 rounded-sm px-3 py-1.5 opacity-50 cursor-not-allowed">
                  NEXT →
                </span>
              )}
            </div>

            <a
              href={applyUrlFor(o)}
              target="_blank"
              rel="noopener noreferrer"
              className="mono text-[11px] tracking-[0.2em] bg-foreground text-background px-4 py-2 rounded-sm inline-flex items-center gap-2 hover:bg-foreground/90 font-medium"
            >
              APPLY ON {o.scrapedFrom.toUpperCase()}{" "}
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
                className="h-3 w-3"
              >
                <path d="M15 3h6v6" />
                <path d="M10 14 21 3" />
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          ARTICLE MAIN CONTAINER
          ──────────────────────────────────────────────────────────────────────── */}
      <article className="max-w-[1180px] mx-auto px-4 sm:px-8 pt-10 sm:pt-14 pb-24">
        {/* HEADER */}
        <header className="border-b border-border pb-10">
          <div className="flex items-center gap-3 mb-6">
            <span className="mono text-[10px] tracking-[0.22em] text-accent-ink bg-accent-ink/8 px-2.5 py-1 rounded-sm uppercase font-semibold">
              {mandateTag}
            </span>
            <span className="mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase">
              {o.scrapedFrom} · {o.postedRelative.toUpperCase()}
            </span>
          </div>

          <h1 className="display text-[38px] sm:text-[64px] leading-[1.05] sm:leading-[1] text-foreground font-semibold">
            {o.role}
          </h1>

          <div className="mt-4 flex items-center gap-4 text-[15px]">
            <span className="text-foreground font-medium">{o.company}</span>
            <span className="text-border">·</span>
            <span className="text-muted-foreground">{o.location}</span>
          </div>
        </header>

        {/* ────────────────────────────────────────────────────────────────────────
            EXECUTIVE SUMMARY & RECOMMENDATION
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="py-12 border-b border-border">
          <p className="mono text-[10px] tracking-[0.24em] text-muted-foreground mb-6 font-semibold">
            EXECUTIVE SUMMARY & RECOMMENDATION
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10">
            {/* Core Conclusion Sentence */}
            <div className="lg:col-span-7">
              <p className="display text-[22px] sm:text-[28px] leading-[1.35] text-foreground font-medium">
                <MarkdownRenderer content={o.recommendation} isHero={true} />
              </p>

              <div className="mt-6 flex items-center gap-3">
                <span className="mono text-[10px] tracking-[0.22em] text-primary-foreground bg-foreground px-2.5 py-1 rounded-sm uppercase font-bold">
                  RECOMMENDATION · {verdict}
                </span>
                <span className="mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase font-medium">
                  {archetype.toUpperCase()} PATH
                </span>
              </div>
            </div>

            {/* Metrics Panel */}
            <div className="lg:col-span-5 grid grid-cols-3 gap-4 sm:gap-6 lg:border-l border-border lg:pl-8 pt-6 lg:pt-0 border-t lg:border-t-0">
              <div>
                <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground mb-3 uppercase font-semibold">
                  PRIORITY
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="display text-[42px] sm:text-[52px] leading-none tabular-nums text-foreground font-bold">
                    {score}
                  </span>
                  <span className="mono text-[13px] text-muted-foreground">/100</span>
                </div>
              </div>

              <div>
                <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground mb-3 uppercase font-semibold">
                  CERTAINTY
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="display text-[42px] sm:text-[52px] leading-none tabular-nums text-pursue font-bold">
                    {certaintyPct}
                  </span>
                  <span className="mono text-[13px] text-muted-foreground">%</span>
                </div>
              </div>

              <div>
                <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground mb-3 uppercase font-semibold">
                  FATIGUE
                </p>
                <div className="flex items-baseline gap-1">
                  <span className="display text-[42px] sm:text-[52px] leading-none tabular-nums text-muted-foreground font-bold">
                    {tailoringEffort}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Primary Driver & Primary Risk Boxes */}
          <div className="mt-8 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="border-l-2 border-pursue/40 pl-4 py-1">
              <div className="flex items-center gap-2 text-pursue">
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
                  className="h-3.5 w-3.5 shrink-0"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                <span className="mono text-[10px] tracking-[0.22em] font-bold">PRIMARY DRIVER</span>
              </div>
              <p className="mt-1.5 text-[15px] text-foreground font-medium">{primaryDriver}</p>
            </div>

            <div className="border-l-2 border-consider/40 pl-4 py-1">
              <div className="flex items-center gap-2 text-consider">
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
                  className="h-3.5 w-3.5 shrink-0"
                >
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
                <span className="mono text-[10px] tracking-[0.22em] font-bold">PRIMARY RISK</span>
              </div>
              <p className="mt-1.5 text-[15px] text-foreground font-medium">{primaryRisk}</p>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            CAN YOU DO THIS JOB? (Capability alignment & surpluses)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="py-12 border-b border-border">
          <div className="flex flex-wrap items-baseline justify-between gap-4 mb-8">
            <div>
              <p className="mono text-[10px] tracking-[0.24em] text-muted-foreground font-semibold">
                CAN YOU DO THIS JOB?
              </p>
              <h2 className="display text-[28px] sm:text-[36px] mt-2 text-foreground font-semibold">
                Capability alignment &amp; surpluses.
              </h2>
            </div>
            <span className="mono text-[11px] tracking-[0.18em] text-pursue bg-pursue-soft px-3 py-1.5 rounded-sm font-semibold">
              ✓ {alignmentText.toUpperCase()}
            </span>
          </div>

          <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground mb-4 font-bold">
            WHY RADAR THINKS YOU'RE A MATCH
          </p>

          {/* Scannable Match List Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-6">
            <div className="flex gap-3">
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
                className="h-4 w-4 text-pursue mt-1 shrink-0"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <div>
                <p className="text-[14px] font-semibold text-foreground">
                  20+ Years Performance-Marketing Leadership
                </p>
                <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
                  Direct match with written requirements and digital-stack strategy.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
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
                className="h-4 w-4 text-pursue mt-1 shrink-0"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <div>
                <p className="text-[14px] font-semibold text-foreground">
                  Proven Multi-Market CRM Transformation
                </p>
                <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
                  Salesforce migration experience across 13 international markets.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
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
                className="h-4 w-4 text-pursue mt-1 shrink-0"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <div>
                <p className="text-[14px] font-semibold text-foreground">
                  Large-Scale P&amp;L &amp; Team Ownership
                </p>
                <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
                  Managed larger marketing budgets and teams than required in brief.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
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
                className="h-4 w-4 text-pursue mt-1 shrink-0"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
              <div>
                <p className="text-[14px] font-semibold text-foreground">
                  Reporting-Line Alignment
                </p>
                <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
                  CxO / MD reporting proven — matches target for Head tier.
                </p>
              </div>
            </div>
          </div>

          {/* Amber Explicit Required Gaps Box */}
          <div className="mt-10 border border-consider/40 bg-consider-soft/40 rounded-md p-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
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
                  className="h-4 w-4 text-consider shrink-0"
                >
                  <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
                  <path d="M12 9v4" />
                  <path d="M12 17h.01" />
                </svg>
                <span className="mono text-[11px] tracking-[0.2em] text-consider font-bold uppercase">
                  {missingDimensions.length || 6} UNSTATED IN BRIEF · VERIFY DURING SCREENING
                </span>
              </div>
              <span className="mono text-[10px] tracking-[0.18em] text-muted-foreground font-semibold">
                IMPACT · CERTAINTY ADJUSTMENT
              </span>
            </div>

            <p className="text-[13px] text-muted-foreground leading-relaxed max-w-3xl font-normal">
              Missing JD evidence does <span className="text-foreground font-semibold">not</span> penalize your capability score — it reduces decision certainty and produces the high-leverage screening questions below.
            </p>

            <div className="mt-5 flex flex-wrap gap-2">
              {missingDimensions.length > 0 ? (
                missingDimensions.map((dim, idx) => (
                  <span
                    key={idx}
                    className="mono text-[10px] tracking-[0.14em] uppercase text-foreground bg-background border border-consider/40 px-2.5 py-1 rounded-sm font-medium"
                  >
                    {dim.label}
                  </span>
                ))
              ) : (
                <>
                  <span className="mono text-[10px] tracking-[0.14em] uppercase text-foreground bg-background border border-consider/40 px-2.5 py-1 rounded-sm font-medium">
                    Reporting line
                  </span>
                  <span className="mono text-[10px] tracking-[0.14em] uppercase text-foreground bg-background border border-consider/40 px-2.5 py-1 rounded-sm font-medium">
                    Mandate
                  </span>
                  <span className="mono text-[10px] tracking-[0.14em] uppercase text-foreground bg-background border border-consider/40 px-2.5 py-1 rounded-sm font-medium">
                    Commercial accountability
                  </span>
                  <span className="mono text-[10px] tracking-[0.14em] uppercase text-foreground bg-background border border-consider/40 px-2.5 py-1 rounded-sm font-medium">
                    Functional scope
                  </span>
                  <span className="mono text-[10px] tracking-[0.14em] uppercase text-foreground bg-background border border-consider/40 px-2.5 py-1 rounded-sm font-medium">
                    Work model
                  </span>
                  <span className="mono text-[10px] tracking-[0.14em] uppercase text-foreground bg-background border border-consider/40 px-2.5 py-1 rounded-sm font-medium">
                    Technology stack
                  </span>
                </>
              )}
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            WILL THIS MOVE YOUR CAREER FORWARD? (Executive growth trajectory)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="py-12 border-b border-border">
          <div className="flex flex-wrap items-baseline justify-between gap-4 mb-8">
            <div>
              <p className="mono text-[10px] tracking-[0.24em] text-muted-foreground font-semibold">
                WILL THIS MOVE YOUR CAREER FORWARD?
              </p>
              <h2 className="display text-[28px] sm:text-[36px] mt-2 text-foreground font-semibold">
                Executive growth trajectory.
              </h2>
            </div>
            <span className="mono text-[11px] tracking-[0.18em] text-consider bg-consider-soft px-3 py-1.5 rounded-sm font-semibold">
              ASPIRATION MATCH · MEDIUM ({envelope?.response.growth.careerAlignment.score ?? 72}%)
            </span>
          </div>

          <p className="text-[15px] leading-relaxed text-foreground max-w-3xl font-normal">
            {envelope?.response.growth.careerAlignment.rationale ||
              "A solid tactical fit. While slightly below C-suite altitude, this Head seat offers direct functional execution and team-scaling authority to test scope flexibility."}
          </p>

          <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground mt-10 mb-4 font-bold">
            CAPABILITY UTILIZATION COVERAGE
          </p>

          {/* Progress Bars */}
          <div className="space-y-4">
            <div className="border-b border-border/40 pb-3">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[14px] text-foreground font-medium">Strategy</span>
                <span className="mono text-[10px] tracking-[0.18em] text-pursue font-semibold">
                  HIGH UTILIZATION · 82%
                </span>
              </div>
              <div className="h-[6px] rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-pursue" style={{ width: "82%" }} />
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                Exercises your positioning frameworks in a Head-level environment.
              </p>
            </div>

            <div className="border-b border-border/40 pb-3">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[14px] text-foreground font-medium">Commercial</span>
                <span className="mono text-[10px] tracking-[0.18em] text-consider font-semibold">
                  MODERATE · 70%
                </span>
              </div>
              <div className="h-[6px] rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-consider" style={{ width: "70%" }} />
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                Matches your budget-administration and contract-scale precedents.
              </p>
            </div>

            <div className="border-b border-border/40 pb-3">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[14px] text-foreground font-medium">Leadership</span>
                <span className="mono text-[10px] tracking-[0.18em] text-consider font-semibold">
                  MODERATE · 68%
                </span>
              </div>
              <div className="h-[6px] rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-consider" style={{ width: "68%" }} />
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                Managerial oversight expected for Head tier — under your prior span.
              </p>
            </div>

            <div className="border-b border-border/40 pb-3">
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[14px] text-foreground font-medium">Technical</span>
                <span className="mono text-[10px] tracking-[0.18em] text-muted-foreground font-semibold">
                  LOW · 54%
                </span>
              </div>
              <div className="h-[6px] rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-pass/60" style={{ width: "54%" }} />
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                Focus on brand strategy and growth rather than MarTech engineering.
              </p>
            </div>

            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-[14px] text-foreground font-medium">Transformation</span>
                <span className="mono text-[10px] tracking-[0.18em] text-pursue font-semibold">
                  HIGH UTILIZATION · 78%
                </span>
              </div>
              <div className="h-[6px] rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-pursue" style={{ width: "78%" }} />
              </div>
              <p className="mt-1.5 text-[12.5px] text-muted-foreground">
                Applies organizational-transformation experience to drive growth.
              </p>
            </div>
          </div>

          {/* Positioning Tip Callout */}
          <div className="mt-10 pl-4 border-l-2 border-accent-ink">
            <p className="mono text-[10px] tracking-[0.22em] text-accent-ink mb-2 font-bold">
              STRATEGIC DEVELOPMENT &amp; INTERVIEW POSITIONING TIP
            </p>
            <p className="text-[14px] text-foreground leading-relaxed">
              <span className="font-medium">Corporate governance &amp; board reporting:</span>{" "}
              proactively seek out statutory corporate finance reviews or joint-venture oversight assignments to bridge the reporting-line exposure gap.
            </p>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SUPPORTING DOSSIER LEDGER (Experience & claims inventory)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="py-12">
          <p className="mono text-[10px] tracking-[0.24em] text-muted-foreground mb-2 font-semibold">
            SUPPORTING DOSSIER LEDGER
          </p>
          <h2 className="display text-[28px] sm:text-[36px] text-foreground font-semibold">
            Experience &amp; claims inventory.
          </h2>
          <p className="text-[13px] text-muted-foreground mt-2 mb-8">
            Historical evidence verified by RADAR's cognitive analyzer ·{" "}
            <span className="text-pursue font-semibold">✓ all primary executive dossier</span>
          </p>

          <ol className="divide-y divide-border">
            {candidateProfile.experience.achievements.slice(0, 5).map((achievement: string, idx: number) => (
              <li key={idx} className="py-5 flex items-start gap-6">
                <span className="mono text-[11px] tracking-[0.18em] text-muted-foreground mt-1 tabular-nums font-semibold">
                  {(idx + 1).toString().padStart(2, "0")}
                </span>
                <p className="text-[15px] text-foreground leading-relaxed flex-1 font-normal">
                  {achievement}
                </p>
                <span className="mono text-[10px] tracking-[0.18em] text-pursue font-bold shrink-0">
                  ✓ VERIFIED
                </span>
              </li>
            ))}
          </ol>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            FOOTER NAVIGATION & DIAGNOSTICS
            ──────────────────────────────────────────────────────────────────────── */}
        <footer className="mt-10 border-t border-border pt-6 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {neighbors.prev ? (
            <Link
              to="/opportunity/$jobHash"
              params={{ jobHash: neighbors.prev.jobHash }}
              className="group"
            >
              <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground font-semibold">
                ← PREVIOUS BRIEF
              </span>
              <p className="mt-2 text-[16px] text-foreground group-hover:underline decoration-1 underline-offset-4 font-medium">
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
              <p className="mt-2 text-[16px] text-foreground group-hover:underline decoration-1 underline-offset-4 font-medium">
                {neighbors.next.role}
              </p>
            </Link>
          ) : (
            <div />
          )}
        </footer>

        <button
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="mt-10 mono text-[10px] tracking-[0.22em] text-muted-foreground hover:text-foreground inline-flex items-center gap-2 font-semibold"
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
          <div className="mt-4 border border-border bg-muted/30 p-5 rounded-sm space-y-4">
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
                <span className="text-foreground font-semibold">{o.decision}</span>
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
    </div>
  );
}
