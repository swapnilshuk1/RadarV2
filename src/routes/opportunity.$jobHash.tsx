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
      <article className="max-w-[1080px] mx-auto px-4 sm:px-8 pt-6 sm:pt-8">
        {/* ────────────────────────────────────────────────────────────────────────
            VIEWPORT CHAPTER 0: ADVISORY OPENING (HERO)
            ──────────────────────────────────────────────────────────────────────── */}
        <SemanticFocus delayMs={0} className="min-h-[85vh] flex flex-col justify-center py-12">
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

            {/* VERDICT BADGE AND QUIET METADATA */}
            <div className="flex flex-wrap items-center gap-3 mb-6">
              <span className="mono text-[11px] tracking-[0.24em] font-bold bg-pursue-soft text-pursue px-3 py-1 rounded-sm uppercase">
                {currentVerdict}
              </span>
              <span className="text-border/60">|</span>
              <span className="mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase font-semibold">
                {mandateTag}
              </span>
              <span className="mono text-[11px] tracking-[0.22em] text-muted-foreground uppercase font-semibold">
                · {o.location.toUpperCase()}
              </span>
            </div>

            {/* ADVISORY TITLE */}
            <h1 className="display text-[42px] sm:text-[56px] lg:text-[68px] font-bold tracking-tight text-foreground leading-[1.05]">
              {o.role}
            </h1>

            <div className="mt-4 flex items-center gap-3 text-[18px] sm:text-[22px]">
              <span className="text-foreground font-semibold">{o.company}</span>
              <span className="text-border">·</span>
              <span className="text-muted-foreground">{o.location}</span>
            </div>

            {/* ADVISORY NARRATIVE */}
            <div className="mt-10 max-w-3xl">
              <p className="text-[18px] sm:text-[22px] text-foreground leading-relaxed font-normal">
                {brief.strategy.heroAnchor} {brief.memory.tradeoff} {brief.memory.whyNow}
              </p>
            </div>

            {/* RETENTION QUOTE */}
            <blockquote className="mt-8 border-l-4 border-pursue pl-6 py-2">
              <p className="text-[20px] sm:text-[24px] text-foreground font-serif italic font-medium leading-[1.3]">
                “{brief.memory.retentionSentence}”
              </p>
            </blockquote>

            {/* COMPACT DECISION METRICS (3-COLUMN) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-10 mt-10 border-t border-border/30">
              <div>
                <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase mb-2">
                  SCORE & CONFIDENCE
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-[24px] font-bold text-foreground leading-none">{brief.score}</span>
                  <span className="text-[13px] text-muted-foreground">/100 ({brief.certaintyPct}%)</span>
                </div>
              </div>
              <div>
                <p className="mono text-[10px] tracking-[0.22em] text-consider font-bold uppercase mb-2">
                  PRIMARY RISK
                </p>
                <p className="text-[14px] text-foreground font-medium leading-snug">
                  {brief.memory.primaryRisk}
                </p>
              </div>
              <div>
                <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase mb-2">
                  TIME TO APPLY
                </p>
                <p className="text-[14px] text-foreground font-medium leading-snug">
                  Est. {estimatedTimeText}
                </p>
              </div>
            </div>
          </div>
        </SemanticFocus>

        {/* ────────────────────────────────────────────────────────────────────────
            VIEWPORT CHAPTER 3: DOMINANT PRIMARY STORY (70% SPATIAL ELASTICITY)
            ──────────────────────────────────────────────────────────────────────── */}
        <div className="border-t border-border/40" />

        {/* ────────────────────────────────────────────────────────────────────────
            CHAPTER 1: CAREER (CENTERPIECE)
            ──────────────────────────────────────────────────────────────────────── */}
        {presentation.sections.filter(sec => sec.id === "CAREER").map((sec) => (
          <SemanticReveal key={sec.id} delayMs={150} className="py-24 sm:py-32">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 max-w-[1080px]">
              <div className="md:col-span-4 lg:col-span-3">
                <div className="sticky top-24">
                  <span className="font-serif text-[42px] text-muted-foreground/40 block leading-none mb-4">I</span>
                  <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-4 mb-4">THE CASE</h3>
                  <p className="font-serif italic text-[14px] text-muted-foreground leading-relaxed">Should you pursue this opportunity?</p>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-9">
                <div className="max-w-4xl mb-12">
                  <h2 className="text-[34px] sm:text-[46px] text-foreground font-bold font-serif tracking-tight leading-tight">
                    Yes — but for a very specific reason.
                  </h2>
                </div>

                <div className="space-y-12 max-w-5xl">
                  <p className="text-[20px] sm:text-[26px] leading-[1.35] text-foreground font-medium font-serif italic">
                    {envelope?.response.growth.careerAlignment.rationale ||
                      "This role narrows your operating scope today, but meaningfully strengthens your commercial leadership profile—making it a credible stepping stone toward a future CCO position."}
                  </p>

                  <div className="pt-8">
                    <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase mb-6">
                      CAPABILITY UTILIZATION & STRATEGIC FIT COVERAGE
                    </p>

                    <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/40 border border-border/40 bg-card/40 rounded-sm">
                      <div className="p-6">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[16px] text-foreground font-semibold">Strategy</span>
                          <span className="mono text-[9.5px] tracking-[0.16em] text-pursue bg-pursue-soft px-2 py-0.5 rounded-sm font-bold">
                            ADVANTAGE
                          </span>
                        </div>
                        <p className="text-[14px] text-muted-foreground leading-relaxed">
                          Directly aligns with your historical mandate of P&L execution and positioning strategy.
                        </p>
                      </div>
                      <div className="p-6">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[16px] text-foreground font-semibold">Commercial</span>
                          <span className="mono text-[9.5px] tracking-[0.16em] text-muted-foreground bg-muted px-2 py-0.5 rounded-sm font-bold">
                            MODERATE FIT
                          </span>
                        </div>
                        <p className="text-[14px] text-muted-foreground leading-relaxed">
                          Requires adaptation to a different revenue model, though core acquisition principles apply.
                        </p>
                      </div>
                      <div className="p-6">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-[16px] text-foreground font-semibold">Transformation</span>
                          <span className="mono text-[9.5px] tracking-[0.16em] text-pursue bg-pursue-soft px-2 py-0.5 rounded-sm font-bold">
                            ADVANTAGE
                          </span>
                        </div>
                        <p className="text-[14px] text-muted-foreground leading-relaxed">
                          Leverages your experience in restructuring teams for digital scale and commercial agility.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SemanticReveal>
        ))}

        <div className="border-t border-border/40" />

        {/* ────────────────────────────────────────────────────────────────────────
            CHAPTER 2: DELIVERABLES
            ──────────────────────────────────────────────────────────────────────── */}
        {presentation.sections.filter(sec => sec.id === "DELIVERABLES").map((sec) => (
          <SemanticReveal key={sec.id} delayMs={150} className="py-16 sm:py-20">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 max-w-[1080px]">
              <div className="md:col-span-4 lg:col-span-3">
                <div className="sticky top-24">
                  <span className="font-serif text-[42px] text-muted-foreground/40 block leading-none mb-4">II</span>
                  <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-4 mb-4">THE ROLE</h3>
                  <p className="font-serif italic text-[14px] text-muted-foreground leading-relaxed">What success looks like.</p>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-9">
                <div className="mb-10">
                  <h2 className="text-[26px] sm:text-[32px] text-foreground font-bold font-serif tracking-tight mt-2">
                    What will you be expected to deliver?
                  </h2>
                </div>

                <div className="max-w-4xl relative pl-6 sm:pl-10 ml-2 border-l-2 border-border/50 space-y-12 py-2">
                  {brief.deliverablesWork.map((item, i) => (
                    <div key={i} className="relative group">
                      <div className="absolute -left-[31px] sm:-left-[47px] top-0 bg-background border-2 border-accent-ink text-accent-ink mono text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm uppercase tracking-wider flex items-center justify-center min-w-[28px]">
                        {i * 3 + 3}
                      </div>

                      <div className="pl-4">
                        <div className="flex items-center gap-3">
                          <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase font-bold">
                            MONTH {i * 3 + 3}
                          </span>
                        </div>
                        <p className="text-[17px] sm:text-[20px] text-foreground font-semibold leading-relaxed mt-1">
                          {item}
                        </p>
                        {brief.deliverablesValue[i] && (
                          <div className="mt-3 p-3.5 bg-muted/30 border border-border/40 rounded-sm">
                            <p className="text-[13.5px] text-foreground font-medium flex items-start gap-2 leading-relaxed">
                              <span className="text-accent-ink font-bold shrink-0">🎯 OUTCOME:</span>
                              <span>{brief.deliverablesValue[i]}</span>
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                  
                  <div className="pt-6 mt-6 border-t border-border/30 pl-4">
                    <p className="mono text-[10px] tracking-[0.22em] text-pursue font-bold uppercase mb-2">
                      🎯 FIRST 90-DAY SUCCESS FACTOR
                    </p>
                    <p className="text-[15px] sm:text-[16.5px] text-foreground font-normal leading-relaxed">
                      {brief.memory.first90Days}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </SemanticReveal>
        ))}

        <div className="border-t border-border/40" />

        {/* ────────────────────────────────────────────────────────────────────────
            CHAPTER 3: ADVANTAGES (FIT)
            ──────────────────────────────────────────────────────────────────────── */}
        {presentation.sections.filter(sec => sec.id === "FIT").map((sec) => {
          const primaryAdvantage = brief.fitProofs[0];
          const secondaryAdvantages = brief.fitProofs.slice(1);

          return (
            <SemanticReveal key={sec.id} delayMs={150} className="py-16 sm:py-24">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 max-w-[1080px]">
                <div className="md:col-span-4 lg:col-span-3">
                  <div className="sticky top-24">
                    <span className="font-serif text-[42px] text-muted-foreground/40 block leading-none mb-4">III</span>
                    <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-4 mb-4">YOUR ADVANTAGE</h3>
                    <p className="font-serif italic text-[14px] text-muted-foreground leading-relaxed">Why you're unusually well positioned.</p>
                  </div>
                </div>
                <div className="md:col-span-8 lg:col-span-9">
                  <div className="mb-10">
                    <h2 className="text-[26px] sm:text-[32px] text-foreground font-bold font-serif tracking-tight mt-2">
                      Why you will win this role
                    </h2>
                  </div>

                  <div className="max-w-5xl space-y-10">
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
                </div>
              </div>
            </SemanticReveal>
          );
        })}

        <div className="border-t border-border/40" />

        {/* ────────────────────────────────────────────────────────────────────────
            CHAPTER 4: UNKNOWNS
            ──────────────────────────────────────────────────────────────────────── */}
        {presentation.sections.filter(sec => sec.id === "UNKNOWNS").map((sec) => (
          <SemanticReveal key={sec.id} delayMs={150} className="py-12 sm:py-16">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 max-w-[1080px]">
              <div className="md:col-span-4 lg:col-span-3">
                <div className="sticky top-24">
                  <span className="font-serif text-[42px] text-muted-foreground/40 block leading-none mb-4">IV</span>
                  <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-4 mb-4">OPEN QUESTIONS</h3>
                  <p className="font-serif italic text-[14px] text-muted-foreground leading-relaxed">What remains uncertain.</p>
                </div>
              </div>
              <div className="md:col-span-8 lg:col-span-9">
                <div className="mb-8">
                  <h2 className="text-[22px] sm:text-[26px] text-foreground font-bold font-serif tracking-tight mt-2">
                    Where are the biggest unknowns?
                  </h2>
                </div>

                <p className="text-[15px] text-muted-foreground mb-8 max-w-4xl leading-relaxed">{brief.certaintyGuidance}</p>

                <div className="max-w-4xl divide-y divide-border/30 border-y border-border/30">
                  {brief.rankedUnknowns.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-4 py-4">
                      <div className="mt-1">
                        <div className="w-4 h-4 rounded-sm border border-border/60 bg-transparent flex items-center justify-center"></div>
                      </div>
                      <div className="flex-1">
                        <span className="text-[15px] text-foreground font-medium">{item.question}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </SemanticReveal>
        ))}

        <div className="border-t border-border/40" />

        {/* ────────────────────────────────────────────────────────────────────────
            CHAPTER 5: EVIDENCE BEHIND THIS RECOMMENDATION (100% COLLAPSED)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="py-10">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-8 md:gap-16 max-w-[1080px]">
            <div className="md:col-span-4 lg:col-span-3">
              <div className="sticky top-24">
                <span className="font-serif text-[42px] text-muted-foreground/40 block leading-none mb-4">V</span>
                <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-4 mb-4">SUPPORTING EVIDENCE</h3>
                <p className="font-serif italic text-[14px] text-muted-foreground leading-relaxed">How RADAR reached this conclusion.</p>
              </div>
            </div>
            <div className="md:col-span-8 lg:col-span-9">
              <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                <h2 className="display text-[28px] sm:text-[38px] text-foreground font-bold font-serif tracking-tight">
                  Evidence Behind This Recommendation
                </h2>

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
            </div>
          </div>
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
