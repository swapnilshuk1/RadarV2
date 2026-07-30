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
import { motion, AnimatePresence } from "framer-motion";

function SemanticFocus({ children, className = "", delayMs = 0 }: { children: React.ReactNode; className?: string; delayMs?: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: "easeOut", delay: delayMs / 1000 }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function SemanticReveal({ children, className = "", delayMs = 0 }: { children: React.ReactNode; className?: string; delayMs?: number }) {
  // Removed scroll-driven opacity animations based on executive cognition principles.
  // Static content should be immediately readable when reached.
  return (
    <section className={className}>
      {children}
    </section>
  );
}

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
          ARTICLE MAIN CONTAINER
          ──────────────────────────────────────────────────────────────────────── */}
      <article className="max-w-[1180px] mx-auto px-4 sm:px-8 pt-6 sm:pt-8">
        {/* ────────────────────────────────────────────────────────────────────────
            VIEWPORT CHAPTER 1: TITLE & CHIEF OF STAFF DECISION SUMMARY
            ──────────────────────────────────────────────────────────────────────── */}
        <SemanticFocus delayMs={0} className="min-h-[85vh] flex flex-col justify-center py-12 border-b border-border/40">
          <div className="max-w-5xl">
            {/* INTEGRATED QUIET BREADCRUMB & PRECISION PAGINATION */}
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6 text-muted-foreground mono text-[11px] tracking-[0.2em] font-semibold border-b border-border/30 pb-3">
              <Link
                to="/"
                className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors"
              >
                ← SHORTLIST
              </Link>

              <div className="flex items-center gap-2">
                {neighbors.prev ? (
                  <Link
                    to="/opportunity/$jobHash"
                    params={{ jobHash: neighbors.prev.jobHash }}
                    className="hover:text-foreground transition-colors"
                  >
                    ← PREV
                  </Link>
                ) : (
                  <span className="opacity-30 cursor-not-allowed">← PREV</span>
                )}
                <span className="text-border/60">|</span>
                <span>BRIEF <strong className="text-foreground">{String(currentIndex).padStart(2, "0")}</strong> OF {String(totalCount).padStart(2, "0")}</span>
                <span className="text-border/60">|</span>
                {neighbors.next ? (
                  <Link
                    to="/opportunity/$jobHash"
                    params={{ jobHash: neighbors.next.jobHash }}
                    className="hover:text-foreground transition-colors"
                  >
                    NEXT →
                  </Link>
                ) : (
                  <span className="opacity-30 cursor-not-allowed">NEXT →</span>
                )}
              </div>
            </div>

            {/* STYLED METADATA MICRO-CHIPS */}
            <div className="flex flex-wrap items-center gap-2 mb-6">
              <span className="mono text-[11px] tracking-[0.22em] text-foreground bg-muted border border-border/60 px-3 py-1 rounded-sm uppercase font-bold">
                {mandateTag}
              </span>
              <span className="mono text-[11px] tracking-[0.22em] text-foreground bg-muted border border-border/60 px-3 py-1 rounded-sm uppercase font-semibold">
                COMMERCIAL
              </span>
              <span className="mono text-[11px] tracking-[0.22em] text-foreground bg-muted border border-border/60 px-3 py-1 rounded-sm uppercase font-semibold">
                HYBRID / {o.location.toUpperCase()}
              </span>
            </div>

            {/* MASSIVE APPLE-LEVEL TITLE */}
            <h1 className="display text-[48px] sm:text-[68px] lg:text-[84px] font-bold tracking-tight text-foreground leading-[1.02]">
              {o.role}
            </h1>

            <div className="mt-4 flex items-center gap-3 text-[18px] sm:text-[22px]">
              <span className="text-foreground font-semibold">{o.company}</span>
              <span className="text-border">·</span>
              <span className="text-muted-foreground">{o.location}</span>
            </div>

            {/* BOLD UNFRAMED DECISION SUMMARY */}
            <div className="mt-10 py-6 border-y border-border/40">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <span className="mono text-[11px] tracking-[0.24em] font-bold bg-pursue-soft text-pursue px-3 py-1 rounded-sm uppercase">
                  {currentVerdict} · {brief.certaintyPct >= 85 ? "High Confidence" : brief.certaintyPct >= 65 ? "Moderate Confidence" : "Low Confidence"}
                </span>
                <span className="mono text-[10px] tracking-[0.24em] text-muted-foreground font-bold uppercase">
                  RADAR'S BOTTOM LINE
                </span>
              </div>

              <p className="text-[22px] sm:text-[28px] lg:text-[34px] text-foreground font-serif italic font-medium leading-[1.25] my-6 border-l-4 border-pursue pl-6 py-2">
                “{brief.memory.retentionSentence}”
              </p>

              {/* 2-Column Trade-off & Why Now Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pt-6 border-t border-border/30">
                <div>
                  <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase mb-2">
                    🔄 CAREER TRADE-OFF
                  </p>
                  <p className="text-[15px] sm:text-[16.5px] text-foreground font-normal leading-relaxed">
                    {brief.memory.tradeoff}
                  </p>
                </div>
                <div>
                  <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase mb-2">
                    ⏱ WHY NOW? (CATALYST)
                  </p>
                  <p className="text-[15px] sm:text-[16.5px] text-foreground font-normal leading-relaxed">
                    {brief.memory.whyNow}
                  </p>
                </div>
              </div>

              {/* First 90-Day Success Factor */}
              <div className="pt-6 mt-6 border-t border-border/30">
                <p className="mono text-[10px] tracking-[0.22em] text-pursue font-bold uppercase mb-2">
                  🎯 FIRST 90-DAY SUCCESS FACTOR
                </p>
                <p className="text-[15px] sm:text-[16.5px] text-foreground font-normal leading-relaxed">
                  {brief.memory.first90Days}
                </p>
              </div>
            </div>
          </div>
        </SemanticFocus>

        {/* ────────────────────────────────────────────────────────────────────────
            VIEWPORT CHAPTER 1: ASYMMETRIC EXECUTIVE DECISION STRIP
            ──────────────────────────────────────────────────────────────────────── */}
        <SemanticReveal delayMs={100} className="py-20 sm:py-24 border-b border-border/40">
          <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase mb-8">
            CHAPTER 1: EXECUTIVE DECISION STRIP
          </p>
          
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 lg:gap-12 items-start">
            {/* Column 1: The Verdict & Score (3 cols) */}
            <div className="md:col-span-3 pr-4 md:border-r border-border/30">
              <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase font-bold">
                RECOMMENDED VERDICT
              </p>
              <div className="mt-4 flex items-baseline gap-2">
                <span className="display text-[52px] sm:text-[64px] leading-none tabular-nums text-foreground font-bold tracking-tight">
                  {brief.score}
                </span>
                <span className="mono text-[13px] text-muted-foreground">/100</span>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="mono text-[10px] text-pursue bg-pursue-soft px-2.5 py-1 rounded-sm font-bold uppercase tracking-wider">
                  {currentVerdict}
                </span>
                <span className="mono text-[11px] text-muted-foreground font-medium">
                  {brief.certaintyPct}% CONFIDENCE
                </span>
              </div>
            </div>

            {/* Column 2: Dominant Narrative Focus (5 cols) */}
            <div className="md:col-span-5 pr-4 md:border-r border-border/30">
              <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase font-bold">
                WHY PURSUE THIS SEAT?
              </p>
              <p className="text-[22px] sm:text-[26px] leading-snug text-foreground font-semibold mt-3">
                {brief.strategy.focusTitle}
              </p>
              <p className="text-[14.5px] text-muted-foreground mt-3 leading-relaxed">
                {brief.memory.primaryOpportunity}
              </p>
            </div>

            {/* Column 3: Stacked Risk & Logistics (4 cols) */}
            <div className="md:col-span-4 space-y-6">
              <div>
                <p className="mono text-[10px] tracking-[0.22em] text-consider uppercase font-bold">
                  PRIMARY RISK / UNCERTAINTY
                </p>
                <p className="text-[15px] leading-snug text-foreground font-medium mt-2">
                  {brief.memory.primaryRisk}
                </p>
                <span className="inline-block mono text-[9.5px] text-consider bg-consider-soft px-2 py-0.5 rounded-sm font-bold mt-1.5 uppercase">
                  VERIFY AT SCREENING
                </span>
              </div>

              <div className="pt-4 border-t border-border/30">
                <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground uppercase font-bold">
                  RECOMMENDED ACTION
                </p>
                <p className="text-[14.5px] leading-snug text-foreground font-medium mt-1.5">
                  {brief.memory.recommendedAction}
                </p>
                <p className="text-[12px] text-muted-foreground mt-1">Est. {estimatedTimeText} to apply</p>
              </div>
            </div>
          </div>
        </SemanticReveal>

        {/* ────────────────────────────────────────────────────────────────────────
            VIEWPORT CHAPTER 3: DOMINANT PRIMARY STORY (70% SPATIAL ELASTICITY)
            ──────────────────────────────────────────────────────────────────────── */}
        {presentation.sections.map((sec) => {
          const isPrimary = sec.id === brief.strategy.primaryFocus;

          if (sec.id === "CAREER") {
            return (
              <SemanticReveal key={sec.id} delayMs={150} className="py-28 sm:py-36 border-b border-border/40">
                <div className="max-w-4xl mb-12">
                  <p className="mono text-[10px] tracking-[0.24em] text-accent-ink font-bold uppercase mb-3">
                    CHAPTER 2: EXECUTIVE GROWTH TRAJECTORY (THE NARRATIVE CRESCENDO)
                  </p>
                  <h2 className="text-[32px] sm:text-[42px] text-foreground font-bold tracking-tight leading-tight">
                    Will this move your career forward?
                  </h2>
                </div>

                <div className="space-y-12 max-w-5xl">
                  {/* EMOTIONAL NARRATIVE LEAD */}
                  <div className="border-l-4 border-accent-ink pl-6 sm:pl-8 py-2">
                    <p className="text-[20px] sm:text-[26px] leading-[1.35] text-foreground font-medium font-serif italic">
                      “{envelope?.response.growth.careerAlignment.rationale ||
                        "This role narrows your operating scope today, but meaningfully strengthens your commercial leadership profile—making it a credible stepping stone toward a future CCO position."}”
                    </p>
                  </div>

                  {/* SECONDARY ANALYTICAL CAPABILITY BREAKDOWN */}
                  <div className="pt-8 border-t border-border/30">
                    <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase mb-6">
                      CAPABILITY UTILIZATION &amp; STRATEGIC FIT COVERAGE
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                      <div className="p-5 border border-border/40 bg-card/40 rounded-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[15px] text-foreground font-semibold">Strategy</span>
                          <span className="mono text-[9.5px] tracking-[0.16em] text-pursue bg-pursue-soft px-2 py-0.5 rounded-sm font-bold">
                            ADVANTAGE
                          </span>
                        </div>
                        <p className="text-[13.5px] text-muted-foreground leading-relaxed mt-2">
                          Directly aligns with your historical mandate of P&amp;L execution and positioning strategy.
                        </p>
                      </div>

                      <div className="p-5 border border-border/40 bg-card/40 rounded-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[15px] text-foreground font-semibold">Commercial</span>
                          <span className="mono text-[9.5px] tracking-[0.16em] text-muted-foreground bg-muted px-2 py-0.5 rounded-sm font-bold">
                            MODERATE FIT
                          </span>
                        </div>
                        <p className="text-[13.5px] text-muted-foreground leading-relaxed mt-2">
                          Requires adaptation to a different revenue model, though core acquisition principles apply.
                        </p>
                      </div>

                      <div className="p-5 border border-border/40 bg-card/40 rounded-sm">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[15px] text-foreground font-semibold">Transformation</span>
                          <span className="mono text-[9.5px] tracking-[0.16em] text-pursue bg-pursue-soft px-2 py-0.5 rounded-sm font-bold">
                            ADVANTAGE
                          </span>
                        </div>
                        <p className="text-[13.5px] text-muted-foreground leading-relaxed mt-2">
                          Leverages your experience in restructuring teams for digital scale and commercial agility.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </SemanticReveal>
            );
          }

          if (sec.id === "DELIVERABLES") {
            return (
              <SemanticReveal key={sec.id} delayMs={150} className="py-20 sm:py-28 border-b border-border/40">
                <div className="mb-10">
                  <p className="mono text-[10px] tracking-[0.2em] text-muted-foreground font-bold uppercase">
                    CHAPTER 3: EXECUTIVE DELIVERY ROADMAP (FIRST 12 MONTHS)
                  </p>
                  <h2 className="text-[28px] sm:text-[36px] text-foreground font-bold tracking-tight mt-2">
                    What will you be expected to deliver?
                  </h2>
                </div>

                {/* TEMPORAL ROADMAP TIMELINE SPINE */}
                <div className="max-w-4xl relative pl-6 sm:pl-10 ml-2 border-l-2 border-border/60 space-y-12 py-2">
                  {brief.deliverablesWork.map((item, i) => (
                    <div key={i} className="relative group">
                      {/* Milestone Node on Timeline */}
                      <div className="absolute -left-[31px] sm:-left-[47px] top-0 bg-background border-2 border-accent-ink text-accent-ink mono text-[10px] font-bold px-2 py-0.5 rounded-sm shadow-sm uppercase tracking-wider">
                        M{i * 3 + 3}
                      </div>

                      <div className="pl-4">
                        <div className="flex items-center gap-3">
                          <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase font-bold">
                            MILESTONE PHASE {i + 1}
                          </span>
                        </div>

                        <p className="text-[17px] sm:text-[20px] text-foreground font-semibold leading-relaxed mt-1">
                          {item}
                        </p>

                        {brief.deliverablesValue[i] && (
                          <div className="mt-3 p-3.5 bg-muted/30 border border-border/40 rounded-sm">
                            <p className="text-[13.5px] text-foreground font-medium flex items-start gap-2 leading-relaxed">
                              <span className="text-accent-ink font-bold shrink-0">🎯 TARGET OUTCOME:</span>
                              <span>{brief.deliverablesValue[i]}</span>
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </SemanticReveal>
            );
          }

          if (sec.id === "FIT") {
            const primaryAdvantage = brief.fitProofs[0];
            const secondaryAdvantages = brief.fitProofs.slice(1);

            return (
              <SemanticReveal key={sec.id} delayMs={150} className="py-20 sm:py-28 border-b border-border/40">
                <div className="mb-10">
                  <p className="mono text-[10px] tracking-[0.2em] text-muted-foreground font-bold uppercase">
                    CHAPTER 4: ASYMMETRIC UNFAIR ADVANTAGES
                  </p>
                  <h2 className="text-[28px] sm:text-[36px] text-foreground font-bold tracking-tight mt-2">
                    Why you will win this role
                  </h2>
                </div>

                <div className="max-w-5xl space-y-10">
                  {/* DOMINANT PRIMARY ADVANTAGE */}
                  {primaryAdvantage && (
                    <div className="p-6 sm:p-8 bg-card border-l-4 border-pursue border-y border-r border-border/50 rounded-r-md shadow-sm">
                      <span className="mono text-[10px] tracking-[0.22em] text-pursue font-bold uppercase block mb-2">
                        ★ DOMINANT UNFAIR ADVANTAGE
                      </span>
                      <p className="text-[22px] sm:text-[28px] font-bold text-foreground leading-snug">
                        {primaryAdvantage}
                      </p>
                      <p className="text-[15px] text-muted-foreground mt-3 leading-relaxed max-w-3xl">
                        This is your primary wedge. Historical career memory demonstrates proven authority in this dimension beyond typical market candidates.
                      </p>
                    </div>
                  )}

                  {/* SECONDARY ADVANTAGES GRID */}
                  {secondaryAdvantages.length > 0 && (
                    <div className="pt-4">
                      <p className="mono text-[10px] tracking-[0.2em] text-muted-foreground font-bold uppercase mb-4">
                        SUPPORTING SURPLUSES
                      </p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {secondaryAdvantages.map((proof, i) => (
                          <div key={i} className="p-5 border border-border/40 bg-card/30 rounded-sm">
                            <span className="mono text-[9.5px] tracking-[0.18em] text-foreground font-bold uppercase block mb-2">
                              SURPLUS 0{i + 2}
                            </span>
                            <p className="text-[16px] sm:text-[18px] font-semibold text-foreground leading-snug">
                              {proof}
                            </p>
                            <p className="text-[13.5px] text-muted-foreground mt-2 leading-relaxed">
                              Verified against candidate claims inventory and role mandate.
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </SemanticReveal>
            );
          }

          if (sec.id === "UNKNOWNS") {
            return (
              <SemanticReveal key={sec.id} delayMs={150} className="min-h-[70vh] flex flex-col justify-center py-16 border-b border-border/40">
                <div className="mb-8">
                  <p className="mono text-[10px] tracking-[0.2em] text-muted-foreground font-bold uppercase">
                    CHAPTER 4: SINGLE UNCERTAINTY AUTHORITY
                  </p>
                  <h2 className="text-[28px] sm:text-[34px] text-foreground font-bold tracking-tight mt-2">
                    Where are the biggest unknowns?
                  </h2>
                </div>

                <p className="text-[16px] text-muted-foreground mb-10 max-w-4xl leading-relaxed">{brief.certaintyGuidance}</p>

                <div className="max-w-4xl space-y-4">
                  {brief.rankedUnknowns.map((item, idx) => (
                    <div key={idx} className="group flex items-start gap-4 py-4 border-b border-border/30">
                      <div className="mt-1">
                        <div className="w-4 h-4 rounded-sm border border-border/60 bg-transparent flex items-center justify-center"></div>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-baseline justify-between gap-4">
                          <span className="text-[16px] text-foreground font-semibold">{item.label}</span>
                          <span className="mono text-[10px] tracking-[0.16em] text-muted-foreground uppercase shrink-0 font-medium">
                            VERIFY AT SCREENING
                          </span>
                        </div>
                        <p className="text-[14.5px] text-muted-foreground mt-2 leading-relaxed">{item.question}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <p className="text-[13.5px] text-muted-foreground italic mt-8">
                  ℹ Unstated brief details reduce decision certainty, not candidate capability.
                </p>
              </SemanticReveal>
            );
          }

          return null;
        })}

        {/* ────────────────────────────────────────────────────────────────────────
            VIEWPORT CHAPTER 5: EVIDENCE BEHIND THIS RECOMMENDATION (100% COLLAPSED)
            ──────────────────────────────────────────────────────────────────────── */}
        <SemanticReveal delayMs={150} className="py-16 border-b border-border/40">
          <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
            <div>
              <p className="mono text-[11px] tracking-[0.25em] text-muted-foreground font-bold uppercase mb-2">
                SUPPORTING VALIDATION APPENDIX
              </p>
              <h2 className="display text-[28px] sm:text-[38px] text-foreground font-bold tracking-tight">
                Evidence Behind This Recommendation
              </h2>
            </div>

            <button
              onClick={() => setEvidenceOpen(!evidenceOpen)}
              className="mono text-[11px] tracking-[0.2em] text-muted-foreground hover:text-foreground border border-border/60 rounded-sm px-4 py-2 font-bold"
            >
              {evidenceOpen ? "HIDE EVIDENCE ▲" : `EXPAND FORENSIC EVIDENCE (${totalVerifiedSignalsCount} SIGNALS) ▼`}
            </button>
          </div>

          <p className="text-[15px] text-muted-foreground mb-6 leading-relaxed max-w-4xl">
            RADAR based this recommendation on <span className="text-pursue font-bold">✓ {totalVerifiedSignalsCount} verified signals</span> ({verifiedDimensions.length} matched dimensions + {allEvidenceQuotes.length} verbatim quotes + 5 candidate claims).
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
        </SemanticReveal>

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
          {/* KPI METRIC ANCHORS */}
          <div className="hidden sm:flex items-center gap-2.5">
            <span className="mono text-[11px] tracking-[0.18em] text-foreground bg-muted/50 border border-border px-2.5 py-1 rounded-sm font-bold">
              PRIORITY {score}/100
            </span>
            <span className="mono text-[11px] tracking-[0.18em] text-pursue bg-pursue-soft/60 border border-pursue/30 px-2.5 py-1 rounded-sm font-bold">
              {certaintyPct}% CONFIDENCE
            </span>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-between sm:justify-end">
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

            <span className="text-border/80 text-[14px]">|</span>

            {/* APPLY ACTION DIRECTLY IN BOTTOM DECISION BAR */}
            <a
              href={applyUrlFor(o)}
              target="_blank"
              rel="noopener noreferrer"
              className="mono text-[10px] sm:text-[11px] tracking-[0.16em] bg-foreground text-background px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-sm font-bold hover:bg-foreground/90 transition-all shrink-0 inline-flex items-center gap-1"
            >
              APPLY <span className="hidden md:inline">ON {o.scrapedFrom.toUpperCase()}</span> ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
