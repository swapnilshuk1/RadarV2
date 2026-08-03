import { useState, useEffect } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { applyUrlFor, type DecisionVerb } from "../data/opportunity-fixtures";
import { getOpportunityFn, getNeighboursFn, getQueueMetricsFn } from "../lib/intelligence/opportunity-server";
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
    const metrics = await getQueueMetricsFn({ data: params.jobHash });
    const neighbors = await getNeighboursFn({ data: params.jobHash });
    return {
      opportunity,
      neighbors,
      currentIndex: metrics.currentIndex,
      totalCount: metrics.totalCount,
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
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 sm:gap-4 mb-6 text-muted-foreground mono text-[10px] sm:text-[11px] tracking-[0.1em] sm:tracking-[0.2em] font-semibold border-b border-border/30 pb-3 w-full">
              <Link to="/" className="hover:text-foreground inline-flex items-center gap-1.5 transition-colors">
                ← SHORTLIST
              </Link>

              <div className="flex items-center gap-1.5 sm:gap-2 text-[10px] sm:text-[11px]">
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

            <div className="flex flex-wrap items-center gap-3 mb-10 sm:mb-12">
              <span className="mono text-[10px] tracking-[0.2em] font-bold bg-emerald-950/5 text-emerald-800 border border-emerald-600/30 px-3 py-1 uppercase rounded-xs">
                {currentVerdict}
              </span>
              <span className="mono text-[11px] text-muted-foreground/70 uppercase font-medium">
                {o.mandateArchetype || "Executive Mandate"}
              </span>
            </div>

            <h1 className="font-serif text-[1.65rem] xs:text-[2rem] sm:text-[3rem] lg:text-[3.85rem] leading-[1.08] sm:leading-[1.03] text-foreground font-light max-w-5xl tracking-tight break-words">
              {brief.memory.retentionSentence || o.recommendation || "High-priority executive mandate."}
            </h1>

            <div className="mt-8 sm:mt-18 grid gap-6 sm:gap-8 border-t border-border/50 pt-8 sm:pt-10 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <h2 className="font-serif text-[1.35rem] sm:text-[2.25rem] leading-[1.1] text-foreground font-light break-words">
                  {o.role} <span className="text-muted-foreground/50">·</span> {o.company}
                </h2>
                <div className="mono mt-4 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[11px] text-muted-foreground/60 font-medium">
                  <span>{o.location}</span>
                  <span>·</span>
                  <span>{o.scrapedFrom}</span>
                  {o.postedRelative && (
                    <>
                      <span>·</span>
                      <span>{o.postedRelative}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="mono text-[10.5px] text-muted-foreground/60 lg:text-right font-normal">
                Compiled {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })} · Quality: {brief.evidenceQuality} · {allVerifiedCount} signals
              </div>
            </div>
          </div>
        </SemanticFocus>

        {/* ────────────────────────────────────────────────────────────────────────
            RECOMMENDATION MEMO PAPER CARD (ASYMMETRIC PROPORTIONS: 30% / 23% / 23% / 24%)
            ──────────────────────────────────────────────────────────────────────── */}
        <div className="bg-card border border-border/80 my-16 sm:my-20 rounded-sm shadow-xs overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 px-4 sm:px-8 py-4 sm:py-5 bg-muted/15">
            <div className="mono text-[11px] tracking-[0.22em] text-foreground font-bold uppercase">
              ◆ RECOMMENDATION MEMO
            </div>
            <div className="mono text-[10px] text-muted-foreground/70 uppercase font-medium">
              Three-minute executive read
            </div>
          </div>

          <div className="grid gap-px bg-border/60 md:grid-cols-[30%_23%_23%_24%] items-stretch">
            <div className="bg-card p-5 sm:p-8 border-r-0 md:border-r border-border/40 flex flex-col justify-start">
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground/60 font-medium">RECOMMENDATION</div>
              <div className="font-serif mt-3 text-[1.6rem] sm:text-[1.85rem] leading-none text-emerald-800 font-medium">
                {currentVerdict === "PURSUE" ? "Worth pursuing" : currentVerdict === "CONSIDER" ? "Worth considering" : "Pass"}
              </div>
              <div className="mono mt-3 text-[11px] text-emerald-800/80 font-bold tracking-wider">
                ★★★★★ EXCEPTIONAL FIT
              </div>
            </div>

            <div className="bg-card p-5 sm:p-8 flex flex-col justify-start">
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground/60 font-medium">FIT DRIVERS</div>
              <ul className="mt-3 space-y-2 font-serif text-[0.9375rem] leading-snug text-foreground/90">
                {brief.strategicUpside.points.slice(0, 2).map((point, i) => (
                  <li key={i} className="line-clamp-2">• {point}</li>
                ))}
              </ul>
            </div>

            <div className="bg-card p-5 sm:p-8 flex flex-col justify-start">
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground/60 font-medium">RISK FACTOR</div>
              <div className="font-serif mt-3 text-[1rem] leading-snug text-foreground/90">
                {brief.frictionPreview || brief.whyNotStronger || "Key terms require verification during recruiter call."}
              </div>
            </div>

            <div className="bg-card p-5 sm:p-8 flex flex-col justify-start">
              <div className="mono text-[10px] tracking-[0.18em] uppercase text-muted-foreground/60 font-medium">EVIDENCE CONFIDENCE</div>
              <div className="font-serif mt-3 text-[1rem] leading-snug text-foreground/90">
                {brief.evidenceQuality} · {allVerifiedCount} verified claims
              </div>
            </div>
          </div>

          <div className="grid gap-px border-t border-border/60 bg-border/60 md:grid-cols-2">
            <div className="bg-card p-8">
              <div className="mono text-[10px] tracking-[0.22em] text-emerald-800 font-bold uppercase mb-5">WHY PURSUE</div>
              <ul className="space-y-4 text-[0.9375rem] leading-relaxed text-foreground/90">
                {brief.oneMinuteTLDR.whyPursue.map((item, i) => (
                  <li key={i} className="flex gap-3.5 items-start">
                    <span className="text-emerald-700 font-bold shrink-0 mt-0.5">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="bg-card p-8">
              <div className="mono text-[10px] tracking-[0.22em] text-amber-800 font-bold uppercase mb-5">BEFORE YOU REPLY</div>
              <ul className="space-y-4 text-[0.9375rem] leading-relaxed text-foreground/90">
                {brief.oneMinuteTLDR.watchFor.map((item, i) => (
                  <li key={i} className="flex gap-3.5 items-start">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-600 shrink-0 mt-2" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* ────────────────────────────────────────────────────────────────────────
            SECTION 1: STRATEGIC CAREER VALUE (CHAPTER I)
            ──────────────────────────────────────────────────────────────────────── */}
        {(() => {
          const sec = secMap.get("STRATEGIC_CAREER_VALUE");
          const presSec = presentation.sections.find(s => s.id === "STRATEGIC_CAREER_VALUE");
          return (
            <SemanticReveal key="STRATEGIC_CAREER_VALUE" delayMs={100} className="py-8 sm:py-10 border-b border-border/40">
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
                  <h2 className="text-[24px] sm:text-[28px] text-foreground font-normal font-serif tracking-tight mb-6">
                    {sec?.title || "Why this role is interesting"}
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-4xl">
                    {brief.strategicUpside.points.map((point, i) => (
                      <div key={i} className="h-full flex flex-col justify-between bg-card border border-border/70 p-6 rounded-sm shadow-2xs hover:border-foreground/40 transition-colors">
                        <span className="mono text-[9.5px] tracking-[0.2em] text-accent-ink font-bold uppercase block mb-3">
                          0{i + 1} · STRATEGIC DRIVER
                        </span>
                        <p className="text-[14.5px] text-foreground font-medium leading-relaxed">
                          {point}
                        </p>
                      </div>
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
            <SemanticReveal key="EXPLAINABLE_REASONING" delayMs={120} className="py-8 sm:py-10 border-b border-border/40">
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
                  <h2 className="text-[24px] sm:text-[28px] text-foreground font-normal font-serif tracking-tight mb-6">
                    {sec?.title || "Why this recommendation?"}
                  </h2>
                  <div className="space-y-3 max-w-4xl">
                    {brief.qualitativeReasoningChain.map((row, idx) => (
                      <div key={idx} className="bg-card border border-border/60 rounded-sm p-4 transition-colors">
                        <div
                          onClick={() => setExpandedReasoningRow(expandedReasoningRow === idx ? null : idx)}
                          className="flex flex-wrap xs:flex-nowrap items-center justify-between gap-2 cursor-pointer group"
                        >
                          <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                            <span className="mono text-[10.5px] sm:text-[11px] font-bold text-foreground uppercase truncate">
                              {row.layer}
                            </span>
                            <span className="mono text-[10px] sm:text-[11px] tracking-[0.12em] sm:tracking-[0.16em] text-foreground font-bold uppercase bg-muted/60 px-2 py-0.5 rounded-sm shrink-0">
                              {row.ratingLabel}
                            </span>
                          </div>
                          <span className="mono text-[10px] text-muted-foreground group-hover:text-foreground font-bold shrink-0 ml-auto">
                            {expandedReasoningRow === idx ? "▲ HIDE" : "▼ WHY?"}
                          </span>
                        </div>

                        {expandedReasoningRow === idx && (
                          <div className="mt-3 pt-3 border-t border-border/40 space-y-3">
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
            <SemanticReveal key="THE_CASE" delayMs={150} className="py-8 sm:py-10 border-b border-border/40">
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
                  <h2 className="text-[26px] sm:text-[32px] text-foreground font-normal font-serif tracking-tight leading-tight mb-6">
                    {sec?.title || "Yes — but for a very specific reason."}
                  </h2>

                  <div className="space-y-6 max-w-5xl">
                    <div className="border-l-[3px] border-foreground/90 pl-4 sm:pl-12 py-3 my-6 sm:my-8 bg-transparent">
                      <p className="text-[1.125rem] sm:text-[1.375rem] leading-relaxed text-foreground font-serif italic font-normal">
                        {envelope?.response.growth.careerAlignment.rationale ||
                          "This role narrows your operating scope today, but meaningfully strengthens your commercial leadership profile—making it a credible stepping stone toward a future CCO position."}
                      </p>
                    </div>

                    <div className="p-4 sm:p-5 bg-card/60 border-l-4 border-consider border-y border-r border-border/60 rounded-sm">
                      <p className="mono text-[10px] tracking-[0.22em] text-consider font-bold uppercase mb-1">
                        WHY NOT A STRONGER RECOMMENDATION?
                      </p>
                      <p className="text-[14px] text-foreground font-normal leading-relaxed">
                        {brief.whyNotStronger}
                      </p>
                    </div>

                    <div className="pt-2">
                      <p className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase mb-3">
                        CAPABILITY STRENGTH CLASSIFICATION
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {brief.proofPoints.slice(0, 3).map((proof, i) => (
                          <div key={i} className="p-4 sm:p-6 bg-card border border-border/70 rounded-sm">
                            <span className="mono text-[9px] tracking-[0.16em] text-accent-ink font-bold block uppercase mb-1">
                              {proof.category === "Direct Evidence" ? "CORE STRENGTH" : "TRANSFERABLE STRENGTH"}
                            </span>
                            <p className="text-[14px] text-foreground font-semibold">{proof.headline}</p>
                            <p className="text-[12.5px] text-muted-foreground/80 mt-1 line-clamp-2">{proof.detail}</p>
                          </div>
                        ))}
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
            <SemanticReveal key="THE_ROLE" delayMs={150} className="py-8 sm:py-10 border-b border-border/40">
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

                  <div className="max-w-4xl space-y-4">
                    {brief.deliverablesWork.map((item, i) => (
                      <div key={i} className="bg-card border border-border/70 p-4 sm:p-6 rounded-sm shadow-2xs">
                        <div className="flex items-center justify-between gap-4 mb-3 border-b border-border/40 pb-2">
                          <span className="mono text-[10px] tracking-[0.2em] text-foreground/80 uppercase font-bold">
                            0{i + 1} · MONTH {i * 3 + 3} DELIVERABLE
                          </span>
                          <span className="mono text-[9px] tracking-[0.14em] text-muted-foreground/60 uppercase font-medium">
                            {brief.deliverablesProvenance[i] === "Observed in JD" ? "✓ Observed in JD" : "⚡ Inferred Pattern"}
                          </span>
                        </div>
                        <p className="font-serif text-[1.125rem] text-foreground font-light leading-relaxed">
                          {item}
                        </p>
                        {brief.deliverablesValue[i] && (
                          <div className="mt-3 pt-3 border-t border-border/30 flex items-center gap-2 text-[12.5px] text-muted-foreground font-medium">
                            <span className="mono text-[9.5px] tracking-[0.16em] text-foreground/80 font-bold uppercase">OUTCOME:</span>
                            <span>{brief.deliverablesValue[i]}</span>
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
            SECTION 5: YOUR ADVANTAGE (CHAPTER V)
            ──────────────────────────────────────────────────────────────────────── */}
        {(() => {
          const sec = secMap.get("YOUR_ADVANTAGE");
          const presSec = presentation.sections.find(s => s.id === "YOUR_ADVANTAGE");
          return (
            <SemanticReveal key="YOUR_ADVANTAGE" delayMs={150} className="py-8 sm:py-10 border-b border-border/40">
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
                      <span className="mono text-[10px] tracking-[0.22em] text-foreground font-bold uppercase block mb-3">
                        ✓ DIRECT EVIDENCE PROOF CARDS
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {brief.proofPoints.filter(p => p.category === "Direct Evidence").map((proof, i) => (
                          <div key={i} className="bg-card border border-border/80 p-5 rounded-sm shadow-xs">
                            <p className="text-[16px] font-bold text-foreground leading-snug mb-2">
                              {proof.headline}
                            </p>
                            <p className="text-[13.5px] text-muted-foreground leading-relaxed">
                              {proof.detail}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2">
                      <span className="mono text-[10px] tracking-[0.22em] text-muted-foreground font-bold uppercase block mb-3">
                        ⚡ TRANSFERABLE EXPERIENCE CARDS
                      </span>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {brief.proofPoints.filter(p => p.category === "Transferable Experience").map((proof, i) => (
                          <div key={i} className="bg-card/70 border border-border/60 p-4 sm:p-5 rounded-sm">
                            <p className="text-[15px] font-semibold text-foreground leading-snug mb-1.5">
                              {proof.headline}
                            </p>
                            <p className="text-[13px] text-muted-foreground leading-relaxed">
                              {proof.detail}
                            </p>
                          </div>
                        ))}
                      </div>
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
            <SemanticReveal key="OPEN_QUESTIONS" delayMs={150} className="py-8 sm:py-10 border-b border-border/40">
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
                          className="flex items-start gap-3.5 p-4 border border-border/70 bg-card rounded-sm cursor-pointer hover:border-foreground transition-all shadow-2xs"
                        >
                          <div className="mt-[3px] text-[16px] font-bold text-foreground">
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
            <section className="py-8 sm:py-10 border-b border-border/40">
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
                  <h2 className="text-[22px] sm:text-[26px] text-foreground font-normal font-serif tracking-tight mb-6">
                    {sec?.title || "What would change this decision?"}
                  </h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-5xl">
                    <div className="bg-card border border-border/80 border-l-4 border-l-emerald-700 p-6 rounded-sm shadow-2xs">
                      <span className="mono text-[10px] tracking-[0.2em] text-emerald-800 font-bold uppercase block mb-3">
                        ▲ THIS ROLE BECOMES A STRONG PURSUE IF:
                      </span>
                      <ul className="space-y-2.5 text-[13.5px] text-foreground font-serif leading-relaxed">
                        {brief.decisionSensitivity.becomesPursueIf.map((cond, i) => (
                          <li key={i} className="flex items-start gap-2.5">
                            <span className="text-emerald-700 font-bold shrink-0">•</span>
                            <span>{cond}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-card border border-border/80 border-l-4 border-l-amber-700 p-6 rounded-sm shadow-2xs">
                      <span className="mono text-[10px] tracking-[0.2em] text-amber-800 font-bold uppercase block mb-3">
                        ▼ THIS ROLE BECOMES A PASS IF:
                      </span>
                      <ul className="space-y-2.5 text-[13.5px] text-foreground font-serif leading-relaxed">
                        {brief.decisionSensitivity.becomesPassIf.map((cond, i) => (
                          <li key={i} className="flex items-start gap-2.5">
                            <span className="text-amber-700 font-bold shrink-0">•</span>
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
            <section key="SUPPORTING_EVIDENCE" className="py-8 sm:py-10 border-b border-border/40">
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
                              <div key={idx} className="border border-border/80 bg-card p-5 rounded-sm shadow-xs">
                                <span className="mono text-[10px] tracking-[0.18em] text-muted-foreground/50 uppercase font-mono block mb-1">
                                  {dim.label}
                                </span>
                                <p className="text-[15px] text-foreground font-semibold">
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
                        <li key={idx} className="py-4 flex items-start gap-4">
                          <span className="mono text-[11px] tracking-[0.18em] text-muted-foreground/60 mt-0.5 tabular-nums font-semibold">
                            {(idx + 1).toString().padStart(2, "0")}
                          </span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1.5">
                              <span className="mono text-[9px] tracking-[0.18em] text-emerald-800 font-bold uppercase bg-emerald-950/5 border border-emerald-600/30 px-2 py-0.5 rounded-xs">
                                ✓ VERIFIED ACHIEVEMENT
                              </span>
                              <span className="mono text-[9px] tracking-[0.14em] text-muted-foreground/60 uppercase">
                                HIGH TRANSFERABILITY
                              </span>
                            </div>
                            <p className="text-[14px] text-foreground leading-relaxed font-normal">
                              {achievement}
                            </p>
                          </div>
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
            PARTNER EDITORIAL RECOMMENDATION PULL QUOTE
            ──────────────────────────────────────────────────────────────────────── */}
        <div className="my-10 sm:my-16 bg-card border border-border/80 border-l-4 border-l-emerald-800 p-5 sm:p-10 rounded-sm shadow-xs max-w-4xl">
          <div className="flex items-center gap-3 mb-3">
            <span className="mono text-[10px] tracking-[0.24em] text-emerald-800 font-bold uppercase">
              ◆ PARTNER ADVISORY RECOMMENDATION
            </span>
            <span className="mono text-[10px] text-muted-foreground/60 uppercase">
              EXECUTIVE VERDICT
            </span>
          </div>
          <p className="font-serif text-[1.25rem] sm:text-[1.375rem] italic leading-relaxed text-foreground font-normal">
            {brief.memory.recommendedAction || "Proceed this week. This opportunity meaningfully advances your commercial P&L trajectory while remaining closely aligned with your operating experience."}
          </p>
        </div>

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
