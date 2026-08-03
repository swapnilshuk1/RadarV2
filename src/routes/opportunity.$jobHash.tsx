import { useState, useEffect } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { applyUrlFor, type DecisionVerb } from "../data/opportunity-fixtures";
import { getOpportunityFn, getOpportunitiesFn, getNeighboursFn } from "../lib/intelligence/opportunity-server";
import { candidateProfile } from "../data/candidate-profile";
import { DefaultEvaluationAdapter } from "../lib/recommendation/EvaluationAdapter";
import { useDecisions } from "../lib/decisions-store";
import type { EvaluationEnvelope } from "../domain/v4";
import { BriefCompositionEngine } from "../lib/intelligence/editorial/BriefCompositionEngine";
import { EditorialCompositionEngine } from "../lib/intelligence/editorial/EditorialCompositionEngine";
import { PresentationEngine } from "../lib/intelligence/editorial/PresentationEngine";
import { motion } from "framer-motion";

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

function SemanticReveal({ children, className = "" }: { children: React.ReactNode; className?: string; delayMs?: number }) {
  return (
    <section className={className}>
      {children}
    </section>
  );
}

function formatValue(val: any): string {
  if (!val) return "";
  if (typeof val === "object") {
    if (val.value && typeof val.value === "string" && !val.value.startsWith("{")) return String(val.value);
    if (val.rawValue && typeof val.rawValue === "string") return String(val.rawValue);
    if (val.canonicalValue) return formatValue(val.canonicalValue);
    if (val.products && Array.isArray(val.products)) return val.products.join(", ");
    return "";
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
  const [expandedReasoningRow, setExpandedReasoningRow] = useState<number | null>(null);
  const [envelope, setEnvelope] = useState<EvaluationEnvelope | null>(null);
  const [checkedUnknowns, setCheckedUnknowns] = useState<Record<number, boolean>>({});

  const [claimsOpen, setClaimsOpen] = useState(true);
  const [evidenceOpen, setEvidenceOpen] = useState(true);

  const { decisions, decide } = useDecisions();
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

  const score = o.recommendationResult?.score ?? 80;
  const tailoringEffort = o.tailoringEffort || "LOW";
  const brief = BriefCompositionEngine.compose(o);
  const narrative = EditorialCompositionEngine.compose(brief);
  const presentation = PresentationEngine.compose(brief, narrative);

  const secMap = new Map(brief.sections.map((s) => [s.id, s]));

  const isPursue = currentVerdict === "PURSUE";
  const isConsider = currentVerdict === "CONSIDER";
  const isPass = currentVerdict === "PASS";

  const strongEvidenceDimensions = o.dimensions.filter((d) => d.jdEvidence.status === "Explicit");
  const partialEvidenceDimensions = o.dimensions.filter((d) => d.jdEvidence.status === "Inferred");
  const unknownDimensions = o.dimensions.filter((d) => d.bucket === "Missing" || d.jdEvidence.status === "Missing");
  const allVerifiedCount = strongEvidenceDimensions.length + partialEvidenceDimensions.length;

  const isLowEffort = tailoringEffort === "LOW";
  const isHighEffort = tailoringEffort === "HIGH";
  const estimatedTimeText = isLowEffort ? "20 minutes" : isHighEffort ? "2–3 hours" : "45 minutes";

  const toggleCheck = (idx: number) => {
    setCheckedUnknowns(prev => ({ ...prev, [idx]: !prev[idx] }));
  };

  return (
    <div className="min-h-screen bg-background text-foreground pb-24 sm:pb-28">
      <article className="max-w-[1080px] mx-auto px-4 sm:px-8 pt-6 sm:pt-8">

        {/* ────────────────────────────────────────────────────────────────────────
            CHAPTER 0: ULTRA-CLEAN HEADER (<5-SECOND SCAN RULE)
            ──────────────────────────────────────────────────────────────────────── */}
        <SemanticFocus delayMs={0} className="min-h-[40vh] flex flex-col justify-center py-6">
          <div className="max-w-5xl">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-6 text-muted-foreground mono text-[11px] tracking-[0.2em] font-semibold border-b border-border/30 pb-3">
              <Link to="/" className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors">
                ← SHORTLIST
              </Link>

              <div className="flex items-center gap-2">
                {neighbors.prev ? (
                  <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.prev.jobHash }} className="hover:text-foreground transition-colors">
                    ← PREV
                  </Link>
                ) : (
                  <span className="opacity-30 cursor-not-allowed">← PREV</span>
                )}
                <span className="text-border/60">|</span>
                <span>BRIEF <strong className="text-foreground">{String(currentIndex).padStart(2, "0")}</strong> OF {String(totalCount).padStart(2, "0")}</span>
                <span className="text-border/60">|</span>
                {neighbors.next ? (
                  <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.next.jobHash }} className="hover:text-foreground transition-colors">
                    NEXT →
                  </Link>
                ) : (
                  <span className="opacity-30 cursor-not-allowed">NEXT →</span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mb-3">
              <span className="mono text-[11px] tracking-[0.22em] font-bold bg-pursue-soft text-pursue px-3 py-1 rounded-sm uppercase border border-pursue/30">
                {currentVerdict}
              </span>
              <span className="text-border/60">|</span>
              <span className="mono text-[11px] text-foreground font-medium">
                Strong strategic fit
              </span>
              <span className="text-border/60">·</span>
              <span className="mono text-[11px] text-foreground font-medium">
                {brief.evidenceQuality}
              </span>
              <span className="text-border/60">·</span>
              <span className="mono text-[11px] text-muted-foreground font-medium">
                ~{estimatedTimeText} application
              </span>
            </div>

            <h1 className="display text-[36px] sm:text-[48px] lg:text-[56px] font-bold tracking-tight text-foreground leading-[1.05]">
              {o.role.toUpperCase()}
            </h1>

            <div className="mt-2 flex items-center gap-3 text-[17px] sm:text-[19px]">
              <span className="text-foreground font-semibold">{o.company}</span>
              <span className="text-border">·</span>
              <span className="text-muted-foreground">{o.location}</span>
            </div>

            <p className="mt-4 text-[16px] sm:text-[18px] text-foreground font-normal leading-snug">
              {brief.memory.retentionSentence}
            </p>
          </div>
        </SemanticFocus>

        <div className="border-t border-border/40" />

        {/* ────────────────────────────────────────────────────────────────────────
            PROMINENT HERO HERO: THE OPPORTUNITY IN ONE MINUTE (TL;DR)
            ──────────────────────────────────────────────────────────────────────── */}
        <section className="py-8 my-8 bg-card border-2 border-border p-6 sm:p-8 rounded-sm shadow-md">
          <div className="flex items-center justify-between gap-4 mb-4 pb-3 border-b border-border/50">
            <span className="mono text-[11px] tracking-[0.26em] text-accent-ink font-bold uppercase">
              ⚡ IF YOU ONLY READ ONE THING, READ THIS
            </span>
            <span className="mono text-[10px] text-muted-foreground font-semibold uppercase">
              1-MINUTE EXECUTIVE BRIEF
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-8">
            <div className="md:col-span-6 space-y-3">
              <p className="mono text-[10px] tracking-[0.2em] text-pursue font-bold uppercase mb-2">
                WHY PURSUE?
              </p>
              <ul className="space-y-2 text-[14.5px] text-foreground">
                {brief.oneMinuteTLDR.whyPursue.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 leading-relaxed">
                    <span className="text-pursue font-bold shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="md:col-span-6 space-y-3">
              <p className="mono text-[10px] tracking-[0.2em] text-consider font-bold uppercase mb-2">
                WATCH FOR
              </p>
              <ul className="space-y-2 text-[14.5px] text-foreground mb-6">
                {brief.oneMinuteTLDR.watchFor.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 leading-relaxed">
                    <span className="text-consider font-bold shrink-0">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>

              <div className="pt-3 border-t border-border/40 flex items-center justify-between">
                <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase font-bold">BOTTOM LINE</span>
                <span className="text-[17px] text-foreground font-bold font-serif">{brief.oneMinuteTLDR.bottomLine}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 1: STRATEGIC CAREER VALUE (CHAPTER I)
            ──────────────────────────────────────────────────────────────────────── */}
        {(() => {
          const sec = secMap.get("STRATEGIC_CAREER_VALUE");
          const presSec = presentation.sections.find(s => s.id === "STRATEGIC_CAREER_VALUE");
          return (
            <SemanticReveal key="STRATEGIC_CAREER_VALUE" delayMs={100} className="py-10 sm:py-14 border-b border-border/40">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 max-w-[1080px]">
                <div className="md:col-span-3 lg:col-span-2">
                  <div className="sticky top-24">
                    {sec?.numeral && (
                      <span className="font-serif font-light text-[30px] sm:text-[36px] text-muted-foreground/35 block leading-none mb-1.5">{sec.numeral}</span>
                    )}
                    <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-2 mb-2">
                      {sec?.eyebrow || presSec?.editorial.identity || "STRATEGIC CAREER VALUE"}
                    </h3>
                    <p className="font-serif italic text-[13px] text-muted-foreground leading-relaxed">
                      {sec?.expression || presSec?.editorial.expression}
                    </p>
                  </div>
                </div>
                <div className="md:col-span-9 lg:col-span-10">
                  <h2 className="text-[24px] sm:text-[28px] text-foreground font-normal font-serif tracking-tight mb-4">
                    {sec?.title || "Why this role is interesting"}
                  </h2>
                  <div className="pl-4 border-l-2 border-accent-ink space-y-3 max-w-4xl py-1">
                    {brief.strategicUpside.points.map((point, i) => (
                      <p key={i} className="text-[15px] sm:text-[16.5px] text-foreground font-medium leading-relaxed">
                        • {point}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </SemanticReveal>
          );
        })()}

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 2: EXPLAINABLE REASONING (CHAPTER II)
            ──────────────────────────────────────────────────────────────────────── */}
        {(() => {
          const sec = secMap.get("EXPLAINABLE_REASONING");
          const presSec = presentation.sections.find(s => s.id === "EXPLAINABLE_REASONING");
          return (
            <SemanticReveal key="EXPLAINABLE_REASONING" delayMs={120} className="py-10 sm:py-14 border-b border-border/40">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 max-w-[1080px]">
                <div className="md:col-span-3 lg:col-span-2">
                  <div className="sticky top-24">
                    {sec?.numeral && (
                      <span className="font-serif font-light text-[30px] sm:text-[36px] text-muted-foreground/35 block leading-none mb-1.5">{sec.numeral}</span>
                    )}
                    <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-2 mb-2">
                      {sec?.eyebrow || presSec?.editorial.identity || "EXPLAINABLE REASONING"}
                    </h3>
                    <p className="font-serif italic text-[13px] text-muted-foreground leading-relaxed">
                      {sec?.expression || presSec?.editorial.expression}
                    </p>
                  </div>
                </div>
                <div className="md:col-span-9 lg:col-span-10">
                  <h2 className="text-[24px] sm:text-[28px] text-foreground font-normal font-serif tracking-tight mb-4">
                    {sec?.title || "Why this recommendation?"}
                  </h2>
                  <div className="space-y-4 max-w-4xl">
                    {brief.qualitativeReasoningChain.map((row, idx) => (
                      <div key={idx} className="border-b border-border/40 pb-4">
                        <div
                          onClick={() => setExpandedReasoningRow(expandedReasoningRow === idx ? null : idx)}
                          className="flex items-center justify-between cursor-pointer py-1 group"
                        >
                          <div className="flex items-center gap-4">
                            <span className="mono text-[11px] font-bold text-foreground uppercase w-36 sm:w-48">
                              {row.layer}
                            </span>
                            <span className="mono text-[11px] tracking-[0.16em] text-foreground font-bold uppercase bg-muted/60 px-2.5 py-0.5 rounded-sm">
                              {row.ratingLabel}
                            </span>
                          </div>
                          <span className="mono text-[10px] text-muted-foreground group-hover:text-foreground font-bold">
                            {expandedReasoningRow === idx ? "▲ HIDE" : "▼ WHY?"}
                          </span>
                        </div>

                        {expandedReasoningRow === idx && (
                          <div className="mt-3 p-4 bg-card border border-border/60 rounded-sm space-y-3">
                            <div>
                              <span className="mono text-[9.5px] text-muted-foreground font-bold uppercase block mb-1">
                                BECAUSE:
                              </span>
                              <div className="space-y-1">
                                {row.becausePoints.map((b, bIdx) => (
                                  <p key={bIdx} className="text-[13.5px] text-foreground font-medium flex items-center gap-2">
                                    <span className="text-pursue font-bold">✓</span>
                                    <span>{b}</span>
                                  </p>
                                ))}
                              </div>
                            </div>

                            <div className="pt-2 border-t border-border/40">
                              <span className="mono text-[9.5px] text-muted-foreground font-bold uppercase block mb-0.5">
                                EVIDENCE PRECEDENT:
                              </span>
                              <p className="text-[12.5px] text-muted-foreground italic">
                                “{row.evidenceSnippet}”
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SemanticReveal>
          );
        })()}

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 3: THE CASE (CHAPTER III)
            ──────────────────────────────────────────────────────────────────────── */}
        {(() => {
          const sec = secMap.get("THE_CASE");
          const presSec = presentation.sections.find(s => s.id === "THE_CASE");
          return (
            <SemanticReveal key="THE_CASE" delayMs={150} className="py-10 sm:py-14 border-b border-border/40">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 max-w-[1080px]">
                <div className="md:col-span-3 lg:col-span-2">
                  <div className="sticky top-24">
                    {sec?.numeral && (
                      <span className="font-serif font-light text-[30px] sm:text-[36px] text-muted-foreground/35 block leading-none mb-1.5">{sec.numeral}</span>
                    )}
                    <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-2 mb-2">
                      {sec?.eyebrow || presSec?.editorial.identity || "THE CASE"}
                    </h3>
                    <p className="font-serif italic text-[13px] text-muted-foreground leading-relaxed">
                      {sec?.expression || presSec?.editorial.expression}
                    </p>
                  </div>
                </div>
                <div className="md:col-span-9 lg:col-span-10">
                  <h2 className="text-[26px] sm:text-[32px] text-foreground font-normal font-serif tracking-tight leading-tight mb-4">
                    {sec?.title || "Yes — but for a very specific reason."}
                  </h2>

                  <div className="space-y-4 max-w-5xl">
                    <p className="text-[16px] sm:text-[19px] leading-relaxed text-foreground font-serif italic font-normal">
                      {envelope?.response.growth.careerAlignment.rationale ||
                        "This role narrows your operating scope today, but meaningfully strengthens your commercial leadership profile—making it a credible stepping stone toward a future CCO position."}
                    </p>

                    <div className="pl-4 border-l-2 border-consider py-1">
                      <p className="mono text-[10px] tracking-[0.22em] text-consider font-bold uppercase mb-0.5">
                        WHY NOT A STRONGER RECOMMENDATION?
                      </p>
                      <p className="text-[14px] text-foreground font-normal">
                        {brief.whyNotStronger}
                      </p>
                    </div>

                    <div className="pt-4">
                      <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase mb-3">
                        CAPABILITY STRENGTH CLASSIFICATION
                      </p>

                      <div className="space-y-3">
                        <div className="pl-3 border-l-2 border-border">
                          <span className="mono text-[9.5px] tracking-[0.16em] text-foreground font-bold block uppercase">
                            CORE STRENGTH: Growth &amp; Acquisition Strategy
                          </span>
                          <p className="text-[13px] text-muted-foreground mt-0.5">Direct alignment with historical P&amp;L precedent.</p>
                        </div>

                        <div className="pl-3 border-l-2 border-border">
                          <span className="mono text-[9.5px] tracking-[0.16em] text-foreground font-bold block uppercase">
                            ADJACENT STRENGTH: Commercial Revenue Models
                          </span>
                          <p className="text-[13px] text-muted-foreground mt-0.5">Core acquisition principles apply to new channels.</p>
                        </div>

                        <div className="pl-3 border-l-2 border-border">
                          <span className="mono text-[9.5px] tracking-[0.16em] text-foreground font-bold block uppercase">
                            TRANSFERABLE STRENGTH: Digital Transformation
                          </span>
                          <p className="text-[13px] text-muted-foreground mt-0.5">Restructuring teams along ESG relationship paths.</p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </SemanticReveal>
          );
        })()}

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 4: THE ROLE (CHAPTER IV)
            ──────────────────────────────────────────────────────────────────────── */}
        {(() => {
          const sec = secMap.get("THE_ROLE");
          const presSec = presentation.sections.find(s => s.id === "THE_ROLE");
          return (
            <SemanticReveal key="THE_ROLE" delayMs={150} className="py-10 sm:py-14 border-b border-border/40">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 max-w-[1080px]">
                <div className="md:col-span-3 lg:col-span-2">
                  <div className="sticky top-24">
                    {sec?.numeral && (
                      <span className="font-serif font-light text-[30px] sm:text-[36px] text-muted-foreground/35 block leading-none mb-1.5">{sec.numeral}</span>
                    )}
                    <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-2 mb-2">
                      {sec?.eyebrow || presSec?.editorial.identity || "THE ROLE"}
                    </h3>
                    <p className="font-serif italic text-[13px] text-muted-foreground leading-relaxed">
                      {sec?.expression || presSec?.editorial.expression}
                    </p>
                  </div>
                </div>
                <div className="md:col-span-9 lg:col-span-10">
                  <h2 className="text-[24px] sm:text-[28px] text-foreground font-normal font-serif tracking-tight mb-6">
                    {sec?.title || "What will you be expected to deliver?"}
                  </h2>

                  <div className="max-w-4xl relative pl-6 sm:pl-8 ml-2 border-l-2 border-border/50 space-y-8 py-1">
                    {brief.deliverablesWork.map((item, i) => (
                      <div key={i} className="relative group">
                        <div className="absolute -left-[31px] sm:-left-[43px] top-0 bg-background border-2 border-accent-ink text-accent-ink mono text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm uppercase tracking-wider flex items-center justify-center min-w-[26px]">
                          {i * 3 + 3}
                        </div>

                        <div className="pl-3">
                          <div className="flex items-center gap-3">
                            <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase font-bold">
                              MONTH {i * 3 + 3}
                            </span>
                            <span className="mono text-[9px] tracking-[0.14em] text-muted-foreground uppercase">
                              {brief.deliverablesProvenance[i] === "Observed in JD" ? "✓ Observed in JD" : "⚡ Inferred from Role Pattern"}
                            </span>
                          </div>
                          <p className="text-[15.5px] sm:text-[18px] text-foreground font-semibold leading-relaxed mt-1">
                            {item}
                          </p>
                          {brief.deliverablesValue[i] && (
                            <p className="text-[13px] text-muted-foreground mt-1 font-medium">
                              <span className="text-foreground font-bold">🎯 OUTCOME:</span> {brief.deliverablesValue[i]}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </SemanticReveal>
          );
        })()}

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 5: YOUR ADVANTAGE (CHAPTER V)
            ──────────────────────────────────────────────────────────────────────── */}
        {(() => {
          const sec = secMap.get("YOUR_ADVANTAGE");
          const presSec = presentation.sections.find(s => s.id === "YOUR_ADVANTAGE");
          return (
            <SemanticReveal key="YOUR_ADVANTAGE" delayMs={150} className="py-10 sm:py-14 border-b border-border/40">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 max-w-[1080px]">
                <div className="md:col-span-3 lg:col-span-2">
                  <div className="sticky top-24">
                    {sec?.numeral && (
                      <span className="font-serif font-light text-[30px] sm:text-[36px] text-muted-foreground/35 block leading-none mb-1.5">{sec.numeral}</span>
                    )}
                    <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-2 mb-2">
                      {sec?.eyebrow || presSec?.editorial.identity || "YOUR ADVANTAGE"}
                    </h3>
                    <p className="font-serif italic text-[13px] text-muted-foreground leading-relaxed">
                      {sec?.expression || presSec?.editorial.expression}
                    </p>
                  </div>
                </div>
                <div className="md:col-span-9 lg:col-span-10">
                  <h2 className="text-[24px] sm:text-[28px] text-foreground font-normal font-serif tracking-tight mb-6">
                    {sec?.title || "Why RADAR believes you're well positioned"}
                  </h2>

                  <div className="max-w-5xl space-y-6">
                    <div>
                      <span className="mono text-[10px] tracking-[0.22em] text-foreground font-bold uppercase block mb-2">
                        ✓ DIRECT EVIDENCE
                      </span>
                      {brief.proofPoints.filter(p => p.category === "Direct Evidence").map((proof, i) => (
                        <div key={i} className="pl-4 border-l-2 border-foreground py-1 mb-3">
                          <p className="text-[17px] sm:text-[19px] font-bold text-foreground leading-snug">
                            {proof.headline}
                          </p>
                          <p className="text-[13.5px] text-muted-foreground mt-1 leading-relaxed">
                            {proof.detail}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2">
                      <span className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase block mb-2">
                        ⚡ TRANSFERABLE EXPERIENCE
                      </span>
                      {brief.proofPoints.filter(p => p.category === "Transferable Experience").map((proof, i) => (
                        <div key={i} className="pl-4 border-l-2 border-border py-1">
                          <p className="text-[15px] sm:text-[17px] font-semibold text-foreground leading-snug">
                            {proof.headline}
                          </p>
                          <p className="text-[13px] text-muted-foreground mt-0.5 leading-relaxed">
                            {proof.detail}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </SemanticReveal>
          );
        })()}

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 6: OPEN QUESTIONS (CHAPTER VI)
            ──────────────────────────────────────────────────────────────────────── */}
        {(() => {
          const sec = secMap.get("OPEN_QUESTIONS");
          const presSec = presentation.sections.find(s => s.id === "OPEN_QUESTIONS");
          return (
            <SemanticReveal key="OPEN_QUESTIONS" delayMs={150} className="py-10 sm:py-14 border-b border-border/40">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 max-w-[1080px]">
                <div className="md:col-span-3 lg:col-span-2">
                  <div className="sticky top-24">
                    {sec?.numeral && (
                      <span className="font-serif font-light text-[30px] sm:text-[36px] text-muted-foreground/35 block leading-none mb-1.5">{sec.numeral}</span>
                    )}
                    <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-2 mb-2">
                      {sec?.eyebrow || presSec?.editorial.identity || "OPEN QUESTIONS"}
                    </h3>
                    <p className="font-serif italic text-[13px] text-muted-foreground leading-relaxed">
                      {sec?.expression || presSec?.editorial.expression}
                    </p>
                  </div>
                </div>
                <div className="md:col-span-9 lg:col-span-10">
                  <div className="mb-4">
                    <span className="mono text-[11px] tracking-[0.2em] text-consider font-bold uppercase block mb-1">
                      🚩 RECRUITER CALL CHECKLIST: CLARIFY THESE {brief.rankedUnknowns.length} QUESTIONS
                    </span>
                    <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                      Use these decision-critical items during your initial screening conversation.
                    </p>
                  </div>

                  <div className="max-w-4xl space-y-3 pt-2">
                    {brief.rankedUnknowns.map((item, idx) => {
                      const isChecked = !!checkedUnknowns[idx];
                      return (
                        <div
                          key={idx}
                          onClick={() => toggleCheck(idx)}
                          className="flex items-start gap-3 p-3.5 border border-border/60 bg-card rounded-sm cursor-pointer hover:border-foreground transition-colors"
                        >
                          <div className="mt-0.5 text-[16px] font-bold text-foreground">
                            {isChecked ? "☑" : "☐"}
                          </div>
                          <div className="flex-1">
                            <span className={`text-[14.5px] ${isChecked ? "line-through text-muted-foreground" : "text-foreground font-semibold"}`}>
                              {item.question}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </SemanticReveal>
          );
        })()}

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 7: DECISION BOUNDARIES (CHAPTER VII)
            ──────────────────────────────────────────────────────────────────────── */}
        {(() => {
          const sec = secMap.get("DECISION_BOUNDARIES");
          const presSec = presentation.sections.find(s => s.id === "DECISION_BOUNDARIES");
          return (
            <section className="py-10 sm:py-14 border-b border-border/40">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 max-w-[1080px]">
                <div className="md:col-span-3 lg:col-span-2">
                  <div className="sticky top-24">
                    {sec?.numeral && (
                      <span className="font-serif font-light text-[30px] sm:text-[36px] text-muted-foreground/35 block leading-none mb-1.5">{sec.numeral}</span>
                    )}
                    <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-2 mb-2">
                      {sec?.eyebrow || presSec?.editorial.identity || "DECISION BOUNDARIES"}
                    </h3>
                    <p className="font-serif italic text-[13px] text-muted-foreground leading-relaxed">
                      {sec?.expression || presSec?.editorial.expression}
                    </p>
                  </div>
                </div>
                <div className="md:col-span-9 lg:col-span-10">
                  <h2 className="text-[22px] sm:text-[26px] text-foreground font-normal font-serif tracking-tight mb-4">
                    {sec?.title || "What would change this decision?"}
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="pl-4 border-l-2 border-foreground py-1">
                      <span className="mono text-[10px] tracking-[0.2em] text-foreground font-bold uppercase block mb-2">
                        ▲ THIS ROLE BECOMES A STRONG PURSUE IF:
                      </span>
                      <ul className="space-y-1.5 text-[13.5px] text-foreground">
                        {brief.decisionSensitivity.becomesPursueIf.map((cond, i) => (
                          <li key={i} className="flex items-start gap-2 leading-relaxed">
                            <span className="text-foreground font-bold shrink-0">•</span>
                            <span>{cond}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="pl-4 border-l-2 border-border py-1">
                      <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground font-bold uppercase block mb-2">
                        ▼ THIS ROLE BECOMES A PASS IF:
                      </span>
                      <ul className="space-y-1.5 text-[13.5px] text-foreground">
                        {brief.decisionSensitivity.becomesPassIf.map((cond, i) => (
                          <li key={i} className="flex items-start gap-2 leading-relaxed">
                            <span className="text-muted-foreground font-bold shrink-0">•</span>
                            <span>{cond}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          );
        })()}

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 8: SUPPORTING EVIDENCE (CHAPTER VIII)
            ──────────────────────────────────────────────────────────────────────── */}
        {(() => {
          const sec = secMap.get("SUPPORTING_EVIDENCE");
          const presSec = presentation.sections.find(s => s.id === "SUPPORTING_EVIDENCE");
          return (
            <section key="SUPPORTING_EVIDENCE" className="py-10 sm:py-14 border-b border-border/40">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 max-w-[1080px]">
                <div className="md:col-span-3 lg:col-span-2">
                  <div className="sticky top-24">
                    {sec?.numeral && (
                      <span className="font-serif font-light text-[30px] sm:text-[36px] text-muted-foreground/35 block leading-none mb-1.5">{sec.numeral}</span>
                    )}
                    <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-2 mb-2">
                      {sec?.eyebrow || presSec?.editorial.identity || "SUPPORTING EVIDENCE"}
                    </h3>
                    <p className="font-serif italic text-[13px] text-muted-foreground leading-relaxed">
                      {sec?.expression || presSec?.editorial.expression}
                    </p>
                  </div>
                </div>
                <div className="md:col-span-9 lg:col-span-10">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <h2 className="display text-[24px] sm:text-[30px] text-foreground font-normal font-serif tracking-tight">
                      {sec?.title || "Evidence Behind This Recommendation"}
                    </h2>

                    <button
                      onClick={() => setEvidenceOpen(!evidenceOpen)}
                      className="mono text-[11px] tracking-[0.2em] text-muted-foreground hover:text-foreground border border-border/60 rounded-sm px-3 py-1 font-bold"
                    >
                      {evidenceOpen ? "HIDE EVIDENCE ▲" : `EXPAND FORENSIC EVIDENCE (${allVerifiedCount} SIGNALS) ▼`}
                    </button>
                  </div>

                  {evidenceOpen && (
                    <div className="mt-4 space-y-6">
                      {/* TIER 1: STRONG EXPLICIT EVIDENCE HIGHLIGHTS (BORDERED CARDS) */}
                      {strongEvidenceDimensions.length > 0 && (
                        <div>
                          <span className="mono text-[10px] tracking-[0.22em] text-foreground font-bold uppercase block mb-2">
                            ✓ STRONG EXPLICIT EVIDENCE HIGHLIGHTS ({strongEvidenceDimensions.length})
                          </span>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {strongEvidenceDimensions.map((dim, idx) => (
                              <div key={idx} className="border border-border bg-card p-4 rounded-sm shadow-sm">
                                <span className="mono text-[10px] tracking-[0.16em] text-foreground font-bold uppercase block mb-1">
                                  {dim.label}
                                </span>
                                <p className="text-[14.5px] text-foreground font-bold">
                                  {formatValue(dim.jdEvidence.value)}
                                </p>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* TIER 2: PARTIAL EVIDENCE (UNBOXED LIST) */}
                      {partialEvidenceDimensions.length > 0 && (
                        <div className="pt-2">
                          <span className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase block mb-2">
                            ⚡ PARTIAL / INFERRED EVIDENCE ({partialEvidenceDimensions.length})
                          </span>
                          <div className="space-y-1.5 pl-3 border-l-2 border-border">
                            {partialEvidenceDimensions.map((dim, idx) => (
                              <p key={idx} className="text-[13px] text-foreground font-medium">
                                <span className="font-bold text-muted-foreground uppercase">{dim.label}:</span> {formatValue(dim.jdEvidence.value)}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </section>
          );
        })()}

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 9: DOSSIER LEDGER (CHAPTER IX)
            ──────────────────────────────────────────────────────────────────────── */}
        {(() => {
          const sec = secMap.get("DOSSIER_LEDGER");
          const presSec = presentation.sections.find(s => s.id === "DOSSIER_LEDGER");
          return (
            <section className="py-10 sm:py-14 border-b border-border/40">
              <div className="grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-10 max-w-[1080px]">
                <div className="md:col-span-3 lg:col-span-2">
                  <div className="sticky top-24">
                    {sec?.numeral && (
                      <span className="font-serif font-light text-[30px] sm:text-[36px] text-muted-foreground/35 block leading-none mb-1.5">{sec.numeral}</span>
                    )}
                    <h3 className="mono text-[10px] tracking-[0.24em] text-foreground font-bold uppercase border-b border-border/40 pb-2 mb-2">
                      {sec?.eyebrow || presSec?.editorial.identity || "DOSSIER LEDGER"}
                    </h3>
                    <p className="font-serif italic text-[13px] text-muted-foreground leading-relaxed">
                      {sec?.expression || presSec?.editorial.expression}
                    </p>
                  </div>
                </div>
                <div className="md:col-span-9 lg:col-span-10">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
                    <h2 className="display text-[22px] sm:text-[26px] text-foreground font-normal font-serif">
                      {sec?.title || "Experience & claim summary."}
                    </h2>

                    <button
                      onClick={() => setClaimsOpen(!claimsOpen)}
                      className="mono text-[10px] tracking-[0.18em] text-muted-foreground hover:text-foreground border border-border rounded-sm px-2.5 py-1 font-bold"
                    >
                      {claimsOpen ? "HIDE ▲" : "EXPAND (5 CLAIMS) ▼"}
                    </button>
                  </div>

                  {claimsOpen && (
                    <ol className="divide-y divide-border/40 mt-3">
                      {candidateProfile.experience.achievements.slice(0, 5).map((achievement: string, idx: number) => (
                        <li key={idx} className="py-3 flex items-start gap-4">
                          <span className="mono text-[11px] tracking-[0.18em] text-muted-foreground mt-0.5 tabular-nums font-semibold">
                            {(idx + 1).toString().padStart(2, "0")}
                          </span>
                          <div className="flex-1">
                            <p className="text-[13.5px] text-foreground leading-relaxed font-normal">
                              {achievement}
                            </p>
                            <span className="mono text-[10px] text-muted-foreground font-semibold mt-0.5 block">
                              Transferability Path: Performance Marketing → GTM Strategy
                            </span>
                          </div>
                          <span className="mono text-[10px] tracking-[0.14em] text-foreground font-medium shrink-0 bg-muted px-2 py-0.5 rounded-sm">
                            ✓ Verified
                          </span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              </div>
            </section>
          );
        })()}

        {/* ────────────────────────────────────────────────────────────────────────
            FOOTER META CLOSURE
            ──────────────────────────────────────────────────────────────────────── */}
        <div className="my-8 border-t border-b border-border py-3.5 flex flex-wrap items-center justify-center gap-6 text-muted-foreground mono text-[11px] tracking-[0.18em]">
          <div>
            Generated: <span className="text-foreground font-bold">{new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</span>
          </div>
          <span className="text-border">·</span>
          <div>
            Quality: <span className="text-foreground font-bold">{brief.evidenceQuality}</span>
          </div>
          <span className="text-border/60">·</span>
          <div>
            Signals: <span className="text-foreground font-bold">{allVerifiedCount} verified signals</span>
          </div>
        </div>

        <footer className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-6">
          {neighbors.prev ? (
            <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.prev.jobHash }} className="group">
              <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground font-semibold">
                ← PREVIOUS BRIEF
              </span>
              <p className="mt-1 text-[15px] text-foreground group-hover:underline font-medium">
                {neighbors.prev.role}
              </p>
            </Link>
          ) : <div />}

          {neighbors.next ? (
            <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.next.jobHash }} className="group text-left sm:text-right">
              <span className="mono text-[10px] tracking-[0.2em] text-muted-foreground font-semibold">
                NEXT BRIEF →
              </span>
              <p className="mt-1 text-[15px] text-foreground group-hover:underline font-medium">
                {neighbors.next.role}
              </p>
            </Link>
          ) : <div />}
        </footer>

        <button
          onClick={() => setShowDiagnostics(!showDiagnostics)}
          className="mt-8 mono text-[10px] tracking-[0.22em] text-muted-foreground hover:text-foreground inline-flex items-center gap-2 font-semibold"
        >
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
                <span className="block text-muted-foreground text-[10px] uppercase">Certainty</span>
                <span className="text-foreground font-semibold">{brief.certaintyPct}%</span>
              </div>
              <div>
                <span className="block text-muted-foreground text-[10px] uppercase">Quality</span>
                <span className="text-foreground font-semibold">{brief.evidenceQuality}</span>
              </div>
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
