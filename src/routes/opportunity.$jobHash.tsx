import { useState } from "react";
import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { applyUrlFor, type DecisionVerb } from "../data/opportunity-fixtures";
import { getOpportunityFn, getNeighboursFn, getQueueMetricsFn } from "../lib/intelligence/opportunity-server";
import { candidateProfile } from "../data/candidate-profile";
import { useDecisions } from "../lib/decisions-store";
import { BriefCompositionEngine } from "../lib/intelligence/editorial/BriefCompositionEngine";
import { EditorialContextBuilder } from "../lib/intelligence/editorial/EditorialContext";
import { EditorialPatternSelector } from "../lib/intelligence/editorial/EditorialPatternSelector";
import { NarrativeComposer } from "../lib/intelligence/editorial/NarrativeComposer";
import { unwrapEvidenceValue } from "../lib/intelligence/editorial/SemanticNaturalLanguageResolver";
import { JobProjectionBuilder } from "../lib/intelligence/builders/JobProjectionBuilder";
import { CapabilityAssessmentEngine } from "../lib/intelligence/engines/CapabilityAssessmentEngine";
import { AdvisoryConstitution } from "../lib/intelligence/editorial/AdvisoryConstitution";
import { ExecutionEngine } from "../lib/intelligence/engines/ExecutionEngine";
import { Button } from "@/components/ui/button";
import { ExecutiveActionButton } from "@/components/radar/actions";

export interface EditorialSurfacePolicy {
  readingMode: "deliberate" | "rapid";
  maxNarrativeDensity: "comprehensive" | "high-density";
  maxEvidenceDepth: number;
  interactionStyle: "immersive" | "drilldown";
  emphasisOrder: Array<"verdict" | "opinion" | "before-proceed" | "opportunities" | "uncertainties" | "evidence" | "workspace">;
}

export const ReadingSurfacePolicy: EditorialSurfacePolicy = {
  readingMode: "deliberate",
  maxNarrativeDensity: "comprehensive",
  maxEvidenceDepth: 10,
  interactionStyle: "immersive",
  emphasisOrder: ["verdict", "opinion", "opportunities", "before-proceed", "evidence", "workspace"]
};

export const ExecutiveBriefingPolicy: EditorialSurfacePolicy = {
  readingMode: "rapid",
  maxNarrativeDensity: "high-density",
  maxEvidenceDepth: 3,
  interactionStyle: "drilldown",
  emphasisOrder: ["verdict", "before-proceed", "opinion", "opportunities", "uncertainties", "workspace", "evidence"]
};

interface SurfaceProps {
  opportunity: any;
  brief: any;
  currentVerdict: DecisionVerb;
  decide: (verb: DecisionVerb) => void;
  neighbors: any;
  currentIndex: number;
  totalCount: number;
  jobProj: any;
  candidateProj: any;
  capEval: any;
  executionPkg: any;
  rawDimensions: any[];
}

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
      ],
    };
  },
  component: OpportunityBriefView,
});

function OpportunityBriefView() {
  const { opportunity: o, neighbors, currentIndex, totalCount } = Route.useLoaderData();
  const { decisions, decide: recordDecision } = useDecisions();
  const router = useRouter();

  const currentVerdict: DecisionVerb = (decisions[o.jobHash]?.verb as DecisionVerb) || o.decision;

  const decide = (verb: DecisionVerb) => {
    recordDecision(o.jobHash, verb);
    router.invalidate();
  };

  const brief = BriefCompositionEngine.compose(o, { bypassHistory: true });
  const jobProj = JobProjectionBuilder.build(o);
  const candidateProj = {
    operatingLevel: { value: "EXECUTIVE" as const, confidence: 0.9, evidence: [], evidenceIds: [] },
    workNature: { value: "STRATEGIC_WORK" as const, confidence: 0.9, evidence: [], evidenceIds: [] },
    decisionAuthority: { value: "ENTERPRISE" as const, confidence: 0.9, evidence: [], evidenceIds: [] },
    commercialScope: { value: "ENTERPRISE" as const, confidence: 0.9, evidence: [], evidenceIds: [] },
    yearsOfExperience: 15,
    coreCapabilities: ["CRM Governance", "GTM Strategy", "Performance Marketing", "Revenue Operations", "Customer Intelligence"],
    preferredLocations: ["Bengaluru"],
    preferredWorkModel: "HYBRID" as const,
    executiveThemes: ["Enterprise Growth", "Commercial Leadership", "Digital Transformation"]
  };
  const capEval = CapabilityAssessmentEngine.evaluate(candidateProj, jobProj);
  const executionPkg = ExecutionEngine.validateDecision(candidateProj, jobProj);
  const rawDimensions = o.dimensions || (o as any).evidenceDimensions || [];

  const surfaceProps: SurfaceProps = {
    opportunity: o,
    brief,
    currentVerdict,
    decide,
    neighbors,
    currentIndex,
    totalCount,
    jobProj,
    candidateProj,
    capEval,
    executionPkg,
    rawDimensions,
  };

  return (
    <>
      <div className="desktop-only">
        <ReadingSurface {...surfaceProps} />
      </div>
      <div className="mobile-only">
        <ExecutiveBriefingSurface {...surfaceProps} />
      </div>
    </>
  );
}

function getFocusTopic(o: any, jobProj: any) {
  const driver = o.primaryDriver;
  if (driver && typeof driver === "string" && !driver.toLowerCase().startsWith("head") && driver.length > 5) {
    return driver;
  }

  if (jobProj.trueExecutiveMandate) {
    const mandateMap: Record<string, string> = {
      COMMERCIAL_EXPANSION: "commercial growth & market expansion",
      TRANSFORMATION: "digital & operational transformation",
      TURNAROUND: "operational restructuring & revenue repair",
      GOVERNANCE: "pipeline & platform governance",
      SCALE_UP: "scaling GTM infrastructure"
    };
    if (mandateMap[jobProj.trueExecutiveMandate]) {
      return mandateMap[jobProj.trueExecutiveMandate];
    }
  }

  const coreCap = jobProj.capabilities?.find((c: any) => c.importance === "Core" || c.confidence > 0.7);
  if (coreCap && coreCap.name) {
    return coreCap.name.toLowerCase();
  }

  return "commercial growth and market expansion";
}

/* ────────────────────────────────────────────────────────────────────────
   1. READING SURFACE (Desktop Reading Mode - Immersive & Deliberate)
   ──────────────────────────────────────────────────────────────────────── */
function ReadingSurface({
  opportunity: o,
  brief,
  currentVerdict,
  decide,
  neighbors,
  currentIndex,
  totalCount,
  jobProj,
  executionPkg,
  rawDimensions,
}: SurfaceProps) {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"resume" | "linkedin" | "screening" | "interview">("resume");

  const formatValue = (val: any) => {
    if (!val) return "Not specified in JD";
    const unwrapped = unwrapEvidenceValue(val);
    return unwrapped || "Not specified in JD";
  };

  return (
    <div className="min-h-screen pb-28 bg-background text-foreground font-sans">
      {/* EXECUTIVE SUMMARY HERO FOLD */}
      <header className="border-b border-border bg-background">
        <div className="mx-auto max-w-[1180px] px-8 py-10">
          {/* Nav Sub-Header */}
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="label-mono hover:text-foreground transition-colors font-normal">
              ← Shortlist
            </Link>
            <span className="label-mono font-normal text-muted-foreground">
              Brief {String(currentIndex).padStart(2, "0")} of {totalCount}
            </span>
          </div>

          <div className="mt-8 grid gap-10 lg:grid-cols-[1.5fr_1fr]">
            {/* Left Column: Strategic Mandate & Core Advisory Thesis */}
            <div className="space-y-6">
              {/* Badges & Verbs */}
              <div className="flex flex-wrap items-center gap-2">
                <span className={`label-mono rounded-[3px] px-1.5 py-[3px] leading-none uppercase font-normal ${
                  currentVerdict === "PURSUE"
                    ? "bg-signal text-white"
                    : currentVerdict === "CONSIDER"
                    ? "bg-caution text-white"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {currentVerdict === "PURSUE" ? "Pursue" : currentVerdict === "CONSIDER" ? "Consider" : "Pass"}
                </span>
                <span className="label-mono font-normal">Strong Executive Fit</span>
                <span className="label-mono font-normal">· {brief.evidenceQuality}</span>
                <span className="label-mono font-normal">· 20 minute application</span>
              </div>

              <h1 className="font-display text-5xl leading-[1.05] tracking-tight text-foreground font-normal">
                {o.role} mandate at {o.company} focused on {getFocusTopic(o, jobProj)}
              </h1>

              {/* High-Altitude Strategic Thesis (The Decision Partner's Core Insight) */}
              <div className="border-t border-border/80 pt-5 space-y-3">
                <p className="label-mono text-xs text-primary font-normal uppercase tracking-wider">Executive Advisory Thesis</p>
                <p className="font-serif text-2xl italic leading-relaxed text-foreground font-normal">
                  “{brief.executiveOpinion || "Evaluating strategic executive alignment..."}”
                </p>
              </div>
            </div>

            {/* Right Column: Instant Action Card */}
            <div className="memo-card bg-surface-raised p-6 flex flex-col justify-between border border-border">
              <div>
                <div className="flex items-baseline justify-between gap-2 border-b border-border pb-3">
                  <span className="label-mono text-primary font-normal text-[10px]">Verdict Overview</span>
                  <span className="label-mono font-normal text-muted-foreground text-[10px]">1-Minute TL;DR</span>
                </div>
                
                <p className="mt-4 font-display text-3xl leading-snug text-foreground font-normal">
                  {brief.oneMinuteTLDR.bottomLine}
                </p>
                
                <p className="mt-3 text-xs leading-relaxed text-foreground/90 font-mono border-l-2 border-primary/60 pl-3">
                  {brief.verdictGuidance.actionNotice}
                </p>

                <div className="mt-5 space-y-4">
                  <div className="space-y-1">
                    <p className="label-mono text-signal font-normal text-[10px] tracking-wider">Why Pursue</p>
                    <ul className="space-y-1">
                      {brief.oneMinuteTLDR.whyPursue.slice(0, 2).map((item: string, i: number) => (
                        <li key={i} className="text-[12px] leading-relaxed text-muted-foreground font-normal">
                          • {item}
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="space-y-1">
                    <p className="label-mono text-caution font-normal text-[10px] tracking-wider">Key Risk</p>
                    <ul className="space-y-1">
                      {brief.oneMinuteTLDR.watchFor.slice(0, 1).map((item: string, i: number) => (
                        <li key={i} className="text-[12px] leading-relaxed text-muted-foreground font-normal flex items-start gap-1">
                          <span className="text-caution/80 font-bold">•</span>
                          <span>{item.replace(/^(Strategic|Execution|Market) Risk:\s*/i, '')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* CORE MEMORANDUM GRID */}
      <section className="py-10">
        <div className="memo-container space-y-12">
          {/* SECTION 1: Context */}
          <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
            <div>
              <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Context</p>
              <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">
                Why is the company hiring for this role now?
              </h2>
            </div>
            <div className="space-y-5">
              <div className="space-y-2">
                <p className="font-medium text-lg text-primary font-display">Why this role exists</p>
                <p className="text-sm leading-relaxed text-foreground font-normal">
                  {AdvisoryConstitution.getWhyThisRoleExistsParagraph(o, jobProj, getFocusTopic(o, jobProj))}
                </p>
              </div>

              <div className="border-t border-border pt-4 space-y-2">
                <p className="font-medium text-lg text-primary font-display">What this means for your career</p>
                <ul className="space-y-2">
                  {brief.strategicUpside.points.slice(0, 2).map((pt: string, idx: number) => (
                    <li key={idx} className="text-sm text-muted-foreground leading-relaxed font-normal">• {pt}</li>
                  ))}
                </ul>
              </div>

              <p className="text-xs text-muted-foreground font-mono pt-1 italic">
                <span className="text-foreground font-semibold">Reflection:</span> Consider whether this market trajectory strengthens your executive record over a 3-year horizon.
              </p>
            </div>
          </div>

          {/* SECTION 2: Mandate */}
          <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
            <div>
              <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Mandate</p>
              <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">
                Your Executive Mandate
              </h2>
            </div>
            <div className="space-y-6">
              <div>
                <p className="label-mono text-xs uppercase tracking-wider text-primary font-normal">What success looks like</p>
                <p className="mt-1 text-xs text-muted-foreground font-mono">Within 18–24 months leadership will likely expect you to:</p>
                <ul className="mt-2.5 space-y-2 border-l-2 border-border pl-4">
                  {(jobProj.executiveMission?.successConditions || [
                    `Deliver 24-month revenue & P&L targets under commercial growth mandate`,
                    `Establish operational governance and cross-functional leadership alignment at ${o.company}`,
                    `Build scalable GTM & customer retention infrastructure`
                  ]).map((cond: string, i: number) => (
                    <li key={i} className="text-sm text-foreground font-normal">• {cond}</li>
                  ))}
                </ul>
              </div>

              <div className="border border-border bg-surface-raised/40 p-5 rounded-md space-y-3.5">
                <div className="flex items-center justify-between">
                  <span className="label-mono text-caution font-semibold tracking-wider text-[10px]">Calibrated Recommendation Scoping Boundaries</span>
                  <span className="label-mono text-[9px] text-muted-foreground uppercase">Verified Gating Criteria</span>
                </div>
                <p className="text-[11px] text-muted-foreground italic font-serif leading-relaxed">
                  This advisory evaluation remains valid subject to the following operating parameters being verified during screening:
                </p>
                <div className="grid gap-4 sm:grid-cols-2 pt-1 border-t border-border/40">
                  {executionPkg.recommendationConditions.map((cond: string, i: number) => (
                    <div key={i} className="flex items-start gap-2.5 border-l border-border/80 pl-2.5 py-0.5">
                      <span className="text-signal text-xs leading-none font-bold">✓</span>
                      <div className="space-y-0.5">
                        <p className="text-[9px] font-mono text-muted-foreground leading-none">Condition {String(i + 1).padStart(2, "0")}</p>
                        <p className="text-[12px] text-foreground font-normal leading-normal">{cond}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <p className="label-mono text-xs uppercase tracking-wider text-foreground font-normal">Questions to Validate During Your Screening Call</p>
                {executionPkg.screeningQuestions.map((sq: any, i: number) => (
                  <div key={i} className="memo-card p-3.5 space-y-1.5 text-xs">
                    <p className="font-semibold text-foreground">{i + 1}. {sq.question}</p>
                    <p className="text-muted-foreground leading-relaxed"><span className="text-primary font-medium">Why it matters:</span> {sq.whyItMatters}</p>
                  </div>
                ))}
              </div>

              {/* Partner Observation */}
              <div className="memo-callout space-y-1">
                <span className="label-mono text-xs uppercase tracking-wider text-primary font-semibold">Partner Observation</span>
                <p className="text-sm text-foreground italic leading-relaxed">
                  “The title is less important than the operating latitude. If the commercial mandate proves genuine, this role is materially stronger than its title suggests.”
                </p>
              </div>
            </div>
          </div>

          {/* EXECUTIVE OPINION BOX */}
          <div className="memo-opinion-box space-y-3">
            <div className="flex items-center justify-between border-b border-border pb-3">
              <span className="label-mono text-xs uppercase tracking-wider text-primary font-semibold">Executive Opinion</span>
              <span className="label-mono text-xs text-muted-foreground">Synthesized Advisory Lead</span>
            </div>
            <p className="font-display text-xl leading-relaxed text-foreground font-normal">
              {brief.executiveOpinion || "Evaluating executive alignment..."}
            </p>
          </div>

          {/* SECTION 3: Evidence */}
          <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
            <div>
              <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Evidence</p>
              <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">Evidence Supporting This Recommendation</h2>
            </div>
            <div className="space-y-5">
              <p className="text-xs text-muted-foreground font-normal">Verified evidence demonstrating executive operation at this level:</p>
              <ul className="space-y-4 border-l-2 border-signal pl-4 pt-1">
                {(brief.proofPoints || []).slice(0, 3).map((pt: any, i: number) => {
                  const categoryTitle = i === 0 
                    ? "Commercial leadership at enterprise scale" 
                    : i === 1 
                    ? "Global platform transformation" 
                    : "Cross-functional operating governance";
                  return (
                    <li key={i} className="text-xs text-foreground font-normal space-y-1">
                      <span className="font-semibold text-foreground text-sm block font-display">{categoryTitle}</span>
                      <p className="text-muted-foreground leading-relaxed">{pt.detail}</p>
                    </li>
                  );
                })}
              </ul>
              <div className="rounded border border-border/80 bg-background p-3.5 space-y-1 text-xs">
                <span className="label-mono text-[11px] text-caution font-normal uppercase">Potential Concern</span>
                <p className="text-muted-foreground leading-relaxed">{brief.whyNotStronger || "Limited direct evidence of enterprise RevOps ownership in current record; verify during initial screening call."}</p>
              </div>
            </div>
          </div>

          {/* SECTION 4: Strategy Workspace */}
          <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
            <div>
              <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Strategy</p>
              <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">Present your experience effectively</h2>
            </div>
            <div className="space-y-6">
              <div className="space-y-2 border-l-2 border-caution pl-4">
                <p className="label-mono text-xs uppercase tracking-wider text-caution font-normal">Positioning Advisory</p>
                <p className="text-sm leading-relaxed text-foreground font-normal">
                  {brief.directives?.positioning || "Tailor your narrative to emphasize executive scale and operational governance."}
                </p>
              </div>

              <div className="memo-card space-y-4">
                <div className="flex items-center justify-between gap-2 border-b border-border pb-3">
                  <p className="label-mono text-xs uppercase tracking-wider text-foreground font-normal">Positioning Workspace</p>
                  <div className="flex gap-1.5">
                    {["resume", "linkedin", "screening", "interview"].map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveWorkspaceTab(tab as any)}
                        className={`px-2.5 py-1 label-mono rounded transition-colors ${
                          activeWorkspaceTab === tab ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {tab === "resume" ? "Resume Narrative" : tab === "linkedin" ? "LinkedIn Strategy" : tab === "screening" ? "Screening Call" : "Interview Strategy"}
                      </button>
                    ))}
                  </div>
                </div>

                {activeWorkspaceTab === "resume" && (
                  <div className="space-y-4">
                    {executionPkg.resumeGaps.map((gap: any, i: number) => (
                      <div key={i} className="rounded border border-border bg-background p-3.5 text-xs space-y-2">
                        <p className="font-semibold text-primary">{gap.category}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1 border-r border-border pr-2">
                            <span className="label-mono text-muted-foreground">Current Resume Narrative</span>
                            <p className="text-muted-foreground leading-relaxed">{gap.currentNarrative}</p>
                          </div>
                          <div className="space-y-1">
                            <span className="label-mono text-signal">Suggested Executive Revision</span>
                            <p className="text-foreground font-medium leading-relaxed">{gap.suggestedRevision}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeWorkspaceTab === "linkedin" && (
                  <div className="space-y-3.5 text-xs">
                    <div className="rounded border border-border bg-background p-3.5 space-y-2">
                      <span className="label-mono text-primary">Recommended LinkedIn Headline</span>
                      <p className="text-foreground font-medium">{executionPkg.linkedInStrategy.recommendedHeadline}</p>
                    </div>
                    <div className="rounded border border-border bg-background p-3.5 space-y-2">
                      <span className="label-mono text-primary">Executive About Section Framing</span>
                      <p className="text-muted-foreground leading-relaxed">{executionPkg.linkedInStrategy.executiveAboutFraming}</p>
                    </div>
                  </div>
                )}

                {activeWorkspaceTab === "screening" && (
                  <div className="space-y-3">
                    {executionPkg.screeningQuestions.map((q: any, i: number) => (
                      <div key={i} className="rounded border border-border bg-background p-3 text-xs space-y-1">
                        <p className="font-medium text-foreground">• {q.question}</p>
                        <p className="text-muted-foreground text-xs"><span className="text-primary font-semibold">Why it matters:</span> {q.whyItMatters}</p>
                      </div>
                    ))}
                  </div>
                )}

                {activeWorkspaceTab === "interview" && (
                  <div className="space-y-3.5 text-xs">
                    <div className="rounded border border-border bg-background p-3.5 space-y-1.5">
                      <span className="label-mono text-primary">60-Second Opening Hook</span>
                      <p className="text-foreground italic">{executionPkg.interviewPrep.openingHook}</p>
                    </div>
                    <div className="rounded border border-border bg-background p-3.5 space-y-1.5">
                      <span className="label-mono text-primary">Key Track Record Theme to Emphasize</span>
                      <p className="text-muted-foreground">{executionPkg.interviewPrep.keyThemeToEmphasize}</p>
                    </div>
                    <div className="rounded border border-border bg-background p-3.5 space-y-1.5">
                      <span className="label-mono text-signal">Strategic Question for the Panel</span>
                      <p className="text-foreground font-medium">{executionPkg.interviewPrep.panelQuestion}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* APPENDIX FOOTER DRAWER */}
      <footer className="border-t border-border bg-surface-raised py-8 text-xs">
        <div className="memo-container">
          <details className="group cursor-pointer">
            <summary className="label-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors flex items-center justify-between">
              <span>Appendix: Evidence, Methodology & Claim Lineage</span>
              <span className="text-primary font-normal group-open:rotate-180 transition-transform">▼</span>
            </summary>
            
            <div className="mt-6 space-y-6 border-t border-border pt-6 text-xs text-muted-foreground font-mono">
              <div className="grid gap-6 sm:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-foreground font-semibold uppercase tracking-wider">Methodology</p>
                  <p className="leading-relaxed text-xs">
                    Multi-hop evidence graph traversal, dual-vector capability vs. mandate alignment, and deterministic policy scoring.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-foreground font-semibold uppercase tracking-wider">Provenance & Quality</p>
                  <p className="leading-relaxed text-[11px]">
                    {brief.evidenceQuality} · Verified against 5 core capability ontologies and 75 enterprise product classifications.
                  </p>
                </div>
                <div className="space-y-2">
                  <p className="text-foreground font-semibold uppercase tracking-wider">Engine Version</p>
                  <p className="leading-relaxed text-[11px]">
                    RADAR v2.4 Editorial Engine · Protocol INV-DATA-SUFFICIENCY active.
                  </p>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-foreground font-semibold uppercase tracking-wider">Claim Lineage Ledger</p>
                <div className="divide-y divide-border/40 border-y border-border/40 text-[11px]">
                  {rawDimensions.slice(0, 4).map((dim: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-[10rem_minmax(0,1fr)_auto] gap-4 py-2">
                      <span className="text-foreground font-medium">{dim.label}</span>
                      <span className="truncate">{formatValue(dim.jdEvidence?.value)}</span>
                      <span className="text-primary">{dim.jdEvidence?.confidence || "VERIFIED"}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>
      </footer>

      {/* STICKY BOTTOM ACTION BAR */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 backdrop-blur-md py-2.5">
        <div className="mx-auto max-w-[1180px] px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="label-mono text-muted-foreground font-normal mr-2">Verdict</span>
            <ExecutiveActionButton
              verdict="PURSUE"
              isActive={currentVerdict === "PURSUE"}
              onClick={() => decide("PURSUE")}
            >
              Pursue
            </ExecutiveActionButton>

            <ExecutiveActionButton
              verdict="CONSIDER"
              isActive={currentVerdict === "CONSIDER"}
              onClick={() => decide("CONSIDER")}
            >
              Consider
            </ExecutiveActionButton>

            <ExecutiveActionButton
              verdict="PASS"
              isActive={currentVerdict === "PASS"}
              onClick={() => decide("PASS")}
            >
              Pass
            </ExecutiveActionButton>
          </div>

          {o.applyUrl ? (
            <Button
              asChild
              className="flex items-center justify-center gap-2 rounded bg-foreground px-4 py-2.5 font-mono text-xs text-background uppercase tracking-[0.14em] hover:opacity-90 font-normal h-auto"
            >
              <a href={applyUrlFor(o)} target="_blank" rel="noopener noreferrer">
                Apply direct →
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────
   2. EXECUTIVE BRIEFING SURFACE (Small Display - High Velocity, Action Oriented)
   ──────────────────────────────────────────────────────────────────────── */
function ExecutiveBriefingSurface({
  opportunity: o,
  brief,
  currentVerdict,
  decide,
  neighbors,
  currentIndex,
  totalCount,
  jobProj,
  executionPkg,
}: SurfaceProps) {
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"resume" | "linkedin" | "screening" | "interview">("resume");

  const primaryQuestion = executionPkg.screeningQuestions[0];
  const secondaryQuestions = executionPkg.screeningQuestions.slice(1);

  // Generate highly customized dynamic corporate driver copy for why-hiring
  const recomposedMission = AdvisoryConstitution.getWhyThisRoleExistsParagraph(o, jobProj, getFocusTopic(o, jobProj));

  return (
    <div className="min-h-screen pb-36 bg-background text-foreground font-sans">
      {/* HEADER TITLE BLOCK - Scaled proportionately */}
      <header className="border-b border-border">
        <div className="mx-auto max-w-[1180px] px-5 py-6">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="label-mono hover:text-foreground transition-colors font-normal">
              ← Shortlist
            </Link>
            <span className="label-mono font-normal text-muted-foreground">
              Brief {String(currentIndex).padStart(2, "0")}/{totalCount}
            </span>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className={`label-mono rounded-[3px] px-1.5 py-[2px] leading-none uppercase font-normal text-[10px] ${
              currentVerdict === "PURSUE"
                ? "bg-signal text-white"
                : currentVerdict === "CONSIDER"
                ? "bg-caution text-white"
                : "bg-muted text-muted-foreground"
            }`}>
              {currentVerdict === "PURSUE" ? "Pursue" : currentVerdict === "CONSIDER" ? "Consider" : "Pass"}
            </span>
            <span className="label-mono font-normal text-[10px]">Executive Briefing</span>
          </div>

          <h1 className="mt-3 font-display text-3xl leading-[1.1] tracking-tight text-foreground font-normal">
            {o.role} mandate at {o.company}
          </h1>
        </div>
      </header>

      {/* EXECUTIVE SUMMARY TRADE-OFF CARD */}
      <section className="border-b border-border bg-surface-raised py-6">
        <div className="mx-auto max-w-[1180px] px-5">
          <p className="font-display text-2xl leading-snug text-foreground font-normal">
            {brief.oneMinuteTLDR.bottomLine}
          </p>
          <p className="mt-2 text-xs text-foreground/90 font-mono border-l-2 border-primary pl-2.5 leading-relaxed">
            {brief.verdictGuidance.actionNotice}
          </p>

          <div className="mt-5 memo-card p-4 space-y-4 bg-background border border-border/80">
            <div>
              <p className="label-mono text-signal font-semibold text-[10px] tracking-wider">Opportunity</p>
              <ul className="mt-1.5 space-y-1.5 pl-1.5 text-xs">
                {brief.oneMinuteTLDR.whyPursue.slice(0, 3).map((item: string, i: number) => (
                  <li key={i} className="leading-relaxed text-foreground font-normal">• {item}</li>
                ))}
              </ul>
            </div>

            <div className="border-t border-border/40 pt-3">
              <p className="label-mono text-caution font-semibold text-[10px] tracking-wider">Validate</p>
              <ul className="mt-1.5 space-y-1.5 pl-1.5 text-xs">
                {brief.oneMinuteTLDR.watchFor.slice(0, 3).map((item: string, i: number) => (
                  <li key={i} className="leading-relaxed text-foreground/90 font-normal">• {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* CORE INTEL STREAM - Prioritized with Collapsed Supporting Ledger */}
      <section className="py-8 space-y-8">
        <div className="mx-auto max-w-[1180px] px-5 space-y-8">

          {/* HIGH-PRIORITY 1: Executive Opinion & Partner Voice */}
          <div className="space-y-3">
            <div className="memo-opinion-box p-4 my-0 space-y-2 border border-border/80">
              <div className="flex items-center justify-between border-b border-border/40 pb-2">
                <span className="label-mono text-[9px] uppercase tracking-wider text-primary font-semibold">Executive Opinion</span>
                <span className="label-mono text-[9px] text-muted-foreground">Advisory Lead</span>
              </div>
              <p className="font-display text-base leading-relaxed text-foreground font-normal">
                {brief.executiveOpinion || "Evaluating executive alignment..."}
              </p>
            </div>

            <div className="py-4 border-y border-border/40">
              <div className="border-l-2 border-primary pl-4 py-0.5 space-y-1">
                <span className="label-mono text-[9px] uppercase tracking-wider text-primary font-semibold">Partner Observation</span>
                <p className="text-base italic font-serif leading-relaxed text-foreground font-normal">
                  “The title is less important than the operating latitude. If the commercial mandate proves genuine, this role is materially stronger than its title suggests.”
                </p>
              </div>
            </div>
          </div>

          {/* HIGH-PRIORITY 2: Before You Proceed (The Critical Unknown) */}
          <div className="space-y-2.5">
            <div className="memo-callout border-l-2 border-caution bg-surface-raised p-4 space-y-2">
              <p className="label-mono text-caution font-semibold text-[10px] tracking-wider">Before You Proceed</p>
              <p className="font-display text-lg leading-relaxed text-foreground font-normal">
                {primaryQuestion?.question || "Does this role carry genuine commercial budget authority?"}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed font-mono">
                <span className="text-primary font-semibold">Why it matters:</span> {primaryQuestion?.whyItMatters || "This single answer is most likely to change today's recommendation."}
              </p>
            </div>

            {secondaryQuestions.length > 0 && (
              <details className="group cursor-pointer mt-1">
                <summary className="text-[11px] text-muted-foreground hover:text-foreground font-mono transition-colors flex items-center justify-between py-1 px-1">
                  <span>+ {secondaryQuestions.length} remaining validation questions</span>
                  <span className="text-[9px] group-open:rotate-180 transition-transform">▼</span>
                </summary>
                <div className="mt-3.5 space-y-3.5 pl-3.5 border-l border-border/80">
                  {secondaryQuestions.map((q: any, idx: number) => (
                    <div key={idx} className="space-y-1 text-xs">
                      <p className="font-semibold text-foreground">{q.question}</p>
                      <p className="text-muted-foreground text-[11px] leading-relaxed">
                        <span className="text-primary font-medium">Why it matters:</span> {q.whyItMatters}
                      </p>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>

          {/* COLLAPSIBLE SECONDARY DETAILS: Context, Scoping, and Supporting Evidence Ledger */}
          <details className="group border border-border/80 rounded bg-surface-raised/20 p-4 space-y-4">
            <summary className="label-mono text-[10px] uppercase tracking-wider text-muted-foreground group-open:text-foreground hover:text-foreground flex items-center justify-between cursor-pointer list-none select-none">
              <span>+ Strategic Context & Evidence Ledger</span>
              <span className="text-primary group-open:rotate-180 transition-transform">▼</span>
            </summary>
            
            <div className="mt-4 pt-4 border-t border-border/40 space-y-6">
              {/* SECTION A: Why Hiring (Context) */}
              <div className="space-y-2">
                <h3 className="font-display text-base font-normal text-foreground leading-tight">
                  Why is the company hiring?
                </h3>
                <p className="text-xs leading-relaxed text-muted-foreground font-normal">
                  {recomposedMission}
                </p>
              </div>

              {/* SECTION B: Recommendation Assumptions Checklist */}
              <div className="space-y-2.5">
                <p className="label-mono text-xs uppercase tracking-wider text-caution font-semibold text-[9px]">Recommendation Assumptions</p>
                <ul className="space-y-2 text-xs text-foreground pl-0.5">
                  {executionPkg.recommendationConditions.map((cond: string, i: number) => (
                    <li key={i} className="flex items-start gap-2 leading-relaxed font-normal">
                      <span className="text-signal font-bold">✓</span>
                      <span className="text-xs text-muted-foreground">{cond}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* SECTION C: Evidence Ledger */}
              <div className="space-y-4">
                <h3 className="font-display text-base font-normal text-foreground leading-tight">
                  Evidence Supporting Recommendation
                </h3>
                <div className="space-y-3">
                  <div>
                    <p className="label-mono text-signal font-semibold text-[9px] tracking-wider">Why we're confident</p>
                    <ul className="mt-1.5 space-y-2 text-xs text-foreground pl-0.5 leading-relaxed">
                      {(brief.proofPoints || []).slice(0, 3).map((pt: any, i: number) => {
                        const categoryTitle = i === 0 
                          ? "Commercial leadership at enterprise scale" 
                          : i === 1 
                          ? "Global platform transformation" 
                          : "Cross-functional operating governance";
                        return (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-signal">•</span>
                            <span className="text-xs text-muted-foreground"><strong>{categoryTitle}:</strong> {pt.detail}</span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>

                  <div className="border-t border-border/40 pt-3">
                    <p className="label-mono text-caution font-semibold text-[9px] tracking-wider">Remaining uncertainty</p>
                    <ul className="mt-1.5 space-y-1.5 text-xs text-foreground pl-0.5 leading-relaxed">
                      <li className="flex items-start gap-1.5">
                        <span className="text-caution">•</span>
                        <span className="text-xs text-muted-foreground">{brief.whyNotStronger || "Limited direct evidence of enterprise RevOps ownership in current record; verify during initial screening call."}</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </details>

          {/* SECTION 6: Strategy (2x2 Segment Grid perspective selector) */}
          <div className="space-y-4">
            <h2 className="font-display text-xl font-normal text-foreground leading-tight">
              Present your experience effectively
            </h2>
            <p className="text-xs text-muted-foreground border-l border-caution pl-2.5 leading-relaxed font-normal">
              {brief.directives?.positioning || "Tailor your narrative to emphasize executive scale and operational governance."}
            </p>

            <div className="memo-card p-3 space-y-4 bg-surface-raised border border-border/60">
              <div className="grid grid-cols-2 gap-1.5 border-b border-border/40 pb-3">
                {[
                  { id: "resume", label: "Resume" },
                  { id: "linkedin", label: "LinkedIn" },
                  { id: "screening", label: "Screening Call" },
                  { id: "interview", label: "Interview" }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveWorkspaceTab(tab.id as any)}
                    className={`py-2 px-1 text-center label-mono rounded-[3px] transition-colors border text-[9px] tracking-wider ${
                      activeWorkspaceTab === tab.id
                        ? "bg-foreground text-background border-foreground font-semibold"
                        : "bg-background text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {activeWorkspaceTab === "resume" && (
                <div className="space-y-3 text-[11px] leading-relaxed">
                  {executionPkg.resumeGaps.map((gap: any, i: number) => (
                    <div key={i} className="rounded border border-border bg-background p-3 space-y-2">
                      <p className="font-semibold text-primary">{gap.category}</p>
                      <div className="space-y-2">
                        <div className="space-y-0.5 border-b border-border/40 pb-1.5">
                          <span className="label-mono text-muted-foreground text-[8px] tracking-wide">Current Resume Narrative</span>
                          <p className="text-muted-foreground">{gap.currentNarrative}</p>
                        </div>
                        <div className="space-y-0.5">
                          <span className="label-mono text-signal text-[8px] tracking-wide">Suggested Revision</span>
                          <p className="text-foreground font-semibold">{gap.suggestedRevision}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {activeWorkspaceTab === "linkedin" && (
                <div className="space-y-2.5 text-[11px] leading-relaxed">
                  <div className="rounded border border-border bg-background p-3 space-y-1.5">
                    <span className="label-mono text-primary text-[8px]">Headline</span>
                    <p className="text-foreground font-semibold">{executionPkg.linkedInStrategy.recommendedHeadline}</p>
                  </div>
                  <div className="rounded border border-border bg-background p-3 space-y-1.5">
                    <span className="label-mono text-primary text-[8px]">Framing</span>
                    <p className="text-muted-foreground leading-relaxed">{executionPkg.linkedInStrategy.executiveAboutFraming}</p>
                  </div>
                </div>
              )}

              {activeWorkspaceTab === "screening" && (
                <div className="space-y-2.5 text-[11px] leading-relaxed">
                  {executionPkg.screeningQuestions.map((q: any, i: number) => (
                    <div key={i} className="rounded border border-border bg-background p-3 space-y-1">
                      <p className="font-semibold text-foreground">• {q.question}</p>
                      <p className="text-muted-foreground text-[10px] leading-relaxed">
                        <span className="text-primary font-medium">Why:</span> {q.whyItMatters}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {activeWorkspaceTab === "interview" && (
                <div className="space-y-2.5 text-[11px] leading-relaxed">
                  <div className="rounded border border-border bg-background p-3 space-y-1">
                    <span className="label-mono text-primary text-[8px]">60-Sec Opening Hook</span>
                    <p className="text-foreground italic">{executionPkg.interviewPrep.openingHook}</p>
                  </div>
                  <div className="rounded border border-border bg-background p-3 space-y-1">
                    <span className="label-mono text-primary text-[8px]">Theme to Emphasize</span>
                    <p className="text-muted-foreground">{executionPkg.interviewPrep.keyThemeToEmphasize}</p>
                  </div>
                  <div className="rounded border border-border bg-background p-3 space-y-1">
                    <span className="label-mono text-signal text-[8px]">Panel Question</span>
                    <p className="text-foreground font-semibold">{executionPkg.interviewPrep.panelQuestion}</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* APPENDIX FOOTER - Kept in disclosure where it belongs */}
          <footer className="border-t border-border pt-4 text-[10px] leading-relaxed font-mono text-muted-foreground">
            <details className="group cursor-pointer">
              <summary className="label-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground flex items-center justify-between">
                <span>Appendix</span>
                <span className="text-primary group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="mt-4 space-y-4 border-t border-border/40 pt-4">
                <p><strong>Methodology:</strong> Multi-hop evidence graph traversal, dual-vector alignment, and policy scoring.</p>
                <p><strong>Provenance:</strong> {brief.evidenceQuality} · Verified against 5 core capability ontologies.</p>
                <p><strong>Engine:</strong> RADAR v2.4 Editorial Engine · Protocol INV-DATA-SUFFICIENCY active.</p>
              </div>
            </details>
          </footer>

        </div>
      </section>

      {/* STICKY BOTTOM ACTION BAR */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 backdrop-blur-md py-3">
        <div className="mx-auto max-w-[1180px] px-5">
          <div className="flex flex-col gap-3">
            {/* Left Column: Verdict Controls */}
            <div className="flex flex-1 items-center gap-2">
              <span className="label-mono text-muted-foreground font-normal mr-1 text-[10px] tracking-wider uppercase hidden sm:inline">Verdict</span>
              <ExecutiveActionButton
                verdict="PURSUE"
                isActive={currentVerdict === "PURSUE"}
                onClick={() => decide("PURSUE")}
                className="flex-1 text-[10px]"
              >
                Pursue
              </ExecutiveActionButton>

              <ExecutiveActionButton
                verdict="CONSIDER"
                isActive={currentVerdict === "CONSIDER"}
                onClick={() => decide("CONSIDER")}
                className="flex-1 text-[10px]"
              >
                Consider
              </ExecutiveActionButton>

              <ExecutiveActionButton
                verdict="PASS"
                isActive={currentVerdict === "PASS"}
                onClick={() => decide("PASS")}
                className="flex-1 text-[10px]"
              >
                Pass
              </ExecutiveActionButton>
            </div>

            {/* Right Column: Apply button */}
            {o.applyUrl ? (
              <Button
                asChild
                className="w-full flex items-center justify-center gap-2 rounded bg-foreground px-4 py-2.5 font-mono text-xs text-background uppercase tracking-[0.14em] hover:opacity-90 font-normal h-auto"
              >
                <a href={applyUrlFor(o)} target="_blank" rel="noopener noreferrer">
                  Apply direct →
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
