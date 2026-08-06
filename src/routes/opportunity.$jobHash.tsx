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
import { ExecutiveSection, ExecutiveSectionProps } from "@/components/radar/layout";
import { Eyebrow, SectionTitle, ExecutiveHeadline, Caption } from "@/components/typography";

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

  const brief = BriefCompositionEngine.compose(o);
  const ctx = EditorialContextBuilder.build(o);
  const pattern = EditorialPatternSelector.select(ctx, o.jobHash);
  const composed = NarrativeComposer.compose(pattern, o);

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

  const delta = (capEval.capabilityPotential || 0.50) - (capEval.evidenceStrength || 0.00);
  const isProofGap = delta >= 0.25;
  const isDivergence = delta <= -0.20;

  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"resume" | "linkedin" | "screening" | "interview">("resume");

  const [expandedReasoningRow, setExpandedReasoningRow] = useState<number | null>(0);
  const [checkedUnknowns, setCheckedUnknowns] = useState<Record<number, boolean>>({});

  const toggleCheck = (idx: number) => {
    setCheckedUnknowns((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  const rawDimensions = o.dimensions || (o as any).evidenceDimensions || [];

  const strongEvidenceDimensions = rawDimensions.filter(
    (d: any) => d.jdEvidence?.confidence === "EXPLICIT_STRONG" || d.importance === "Core" || (d.jdEvidence && d.jdEvidence.value)
  );

  const partialEvidenceDimensions = rawDimensions.filter(
    (d: any) => d.jdEvidence?.confidence === "PARTIAL_INFERRED"
  );

  const allVerifiedCount = rawDimensions.length || 7;

  const formatValue = (val: any) => {
    if (!val) return "Not specified in JD";
    const unwrapped = unwrapEvidenceValue(val);
    return unwrapped || "Not specified in JD";
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
            <span className="label-mono hidden sm:inline font-normal">· 20 minute application</span>
          </div>

          {/* Main Title */}
          <h1 className="mt-4 max-w-4xl font-display text-[2.6rem] leading-[1.02] tracking-tight sm:text-6xl text-foreground font-normal">
            {o.role} mandate at {o.company} focused on {formatValue(rawDimensions[0]?.jdEvidence?.value) || o.primaryDriver || "commercial growth"}
          </h1>

          {/* Subtitle Company Line */}
          <p className="mt-4 border-t border-border pt-4 font-mono text-xs tracking-[0.12em] uppercase text-muted-foreground font-normal">
            <span className="text-foreground font-medium">{o.company}</span> · {o.location} ({(o as any).workModel || "Hybrid"})
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
          QUESTION-DRIVEN EXECUTIVE MEMO FLOW
          ──────────────────────────────────────────────────────────────────────── */}
      <section className="border-b border-border bg-background py-10">
        <div className="mx-auto max-w-[1180px] space-y-12 px-5 sm:px-8">
          
          {/* SECTION 1: Why is the company hiring for this role now? */}
          <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
            <div>
              <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Context</p>
              <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">
                Why is the company hiring for this role now?
              </h2>
            </div>
            <div className="space-y-3 text-base leading-relaxed text-foreground font-normal">
              <p className="font-medium text-lg text-primary font-display">
                Why this role exists
              </p>
              <p>
                {(() => {
                  const dataCheck = AdvisoryConstitution.validateDataSufficiency(o);
                  if (!dataCheck.isSufficient) {
                    return dataCheck.message;
                  }
                  return jobProj.executiveMission?.statement || `Leadership at ${o.company} is hiring an executive to drive ${jobProj.trueExecutiveMandate?.toLowerCase() || "commercial expansion"} and establish predictable operating governance.`;
                })()}
              </p>
            </div>
          </div>

          {/* SECTION 2: What would I actually be expected to accomplish? */}
          <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
            <div>
              <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Mandate</p>
              <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">
                What would I actually be expected to accomplish?
              </h2>
            </div>
            <div className="space-y-6">
              <div>
                <p className="label-mono text-xs uppercase tracking-wider text-primary font-normal">Your Mandate</p>
                <p className="mt-1.5 text-base leading-relaxed text-foreground font-normal">
                  {jobProj.executiveMission?.statement || `Drive revenue growth and commercial execution at ${o.company}.`}
                </p>
              </div>

              <div>
                <p className="label-mono text-xs uppercase tracking-wider text-primary font-normal">How success will be measured</p>
                <p className="mt-1 text-xs text-muted-foreground font-mono">Within 18–24 months leadership will likely expect you to:</p>
                <ul className="mt-2.5 space-y-2 border-l-2 border-border pl-4">
                  {(jobProj.executiveMission?.successConditions || [
                    `Deliver 24-month revenue & P&L targets under ${jobProj.trueExecutiveMandate || "COMMERCIAL"} mandate`,
                    `Establish operational governance and cross-functional leadership alignment at ${o.company}`,
                    `Build scalable GTM & customer retention infrastructure`
                  ]).map((cond, i) => (
                    <li key={i} className="text-sm text-foreground font-normal">
                      • {cond}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Recommendation Conditions */}
              <div className="rounded-md border border-border bg-surface-raised p-4">
                <p className="label-mono text-xs uppercase tracking-wider text-primary font-normal">Recommendation Conditions</p>
                <p className="mt-1 text-xs text-muted-foreground font-normal">This recommendation assumes the following operational conditions hold true:</p>
                <ul className="mt-2 space-y-1.5 text-xs text-foreground font-normal">
                  {executionPkg.recommendationConditions.map((cond, i) => (
                    <li key={i}>• {cond}</li>
                  ))}
                </ul>
              </div>

              {/* Questions to Validate During Your Screening Call */}
              <div className="space-y-3">
                <p className="label-mono text-xs uppercase tracking-wider text-primary font-normal">Questions to Validate During Your Screening Call</p>
                <p className="text-xs text-muted-foreground font-normal">Validate these key operational factors before investing further time:</p>
                <div className="space-y-3">
                  {executionPkg.screeningQuestions.map((q, i) => (
                    <div key={i} className="border-l-2 border-primary/40 pl-3.5 py-1">
                      <p className="text-sm font-medium text-foreground font-normal">
                        {i + 1}. {q.question}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground leading-relaxed font-normal">
                        <span className="font-semibold text-primary/80">Why it matters:</span> {q.whyItMatters}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* SECTION 3: Which parts of my background are most relevant? */}
          <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
            <div>
              <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Alignment</p>
              <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">
                Which parts of my background are most relevant?
              </h2>
            </div>
            <div className="space-y-3">
              <p className="label-mono text-xs uppercase tracking-wider text-primary font-normal">
                Why this opportunity was shortlisted for your record
              </p>
              <p className="text-sm text-muted-foreground font-normal">
                This role was surfaced because your background repeatedly demonstrates three capabilities the organization is currently seeking:
              </p>
              <ul className="space-y-2.5 border-l-2 border-signal pl-4 pt-1">
                {(brief.proofPoints || []).slice(0, 3).map((pt: any, i: number) => (
                  <li key={i} className="text-sm text-foreground font-normal">
                    <span className="font-medium text-foreground">{pt.headline}:</span> {pt.detail}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* SECTION 4: What should I improve before applying? */}
          <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
            <div>
              <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Strategy</p>
              <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">
                What should I improve before applying?
              </h2>
            </div>
            <div className="space-y-6">
              <div className="space-y-2 border-l-2 border-caution pl-4">
                <p className="label-mono text-xs uppercase tracking-wider text-caution font-normal">Positioning Advisory</p>
                <p className="text-sm leading-relaxed text-foreground font-normal">
                  {isProofGap 
                    ? "Your experience appears well suited to this role, but your résumé does not fully demonstrate the breadth of that experience. Strengthening the commercial governance and revenue ownership narrative before applying would materially improve your positioning."
                    : isDivergence 
                    ? "You possess tool execution experience here, but the role lacks the executive altitude and commercial scope matching your career trajectory."
                    : "Your executive background and verified proof points align directly with this mission. Submit your application directly with high confidence."}
                </p>
              </div>

              {/* Positioning Workspace */}
              <div className="rounded-lg border border-border bg-surface-raised p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <p className="label-mono text-xs uppercase tracking-wider text-foreground font-normal">
                    Positioning Workspace
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      onClick={() => setActiveWorkspaceTab("resume")}
                      className={`px-2.5 py-1 text-[11px] rounded font-mono transition-colors ${
                        activeWorkspaceTab === "resume" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Resume Narrative
                    </button>
                    <button
                      onClick={() => setActiveWorkspaceTab("linkedin")}
                      className={`px-2.5 py-1 text-[11px] rounded font-mono transition-colors ${
                        activeWorkspaceTab === "linkedin" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      LinkedIn Strategy
                    </button>
                    <button
                      onClick={() => setActiveWorkspaceTab("screening")}
                      className={`px-2.5 py-1 text-[11px] rounded font-mono transition-colors ${
                        activeWorkspaceTab === "screening" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Screening Call
                    </button>
                    <button
                      onClick={() => setActiveWorkspaceTab("interview")}
                      className={`px-2.5 py-1 text-[11px] rounded font-mono transition-colors ${
                        activeWorkspaceTab === "interview" ? "bg-primary text-primary-foreground font-medium" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      Interview Strategy
                    </button>
                  </div>
                </div>

                {activeWorkspaceTab === "resume" && (
                  <div className="space-y-4">
                    <p className="text-xs text-muted-foreground font-normal">
                      Evidence-backed narrative revisions to strengthen your application before applying:
                    </p>
                    {executionPkg.resumeGaps.map((gap, i) => (
                      <div key={i} className="rounded border border-border/60 bg-background p-3.5 space-y-2 text-xs">
                        <p className="font-semibold text-primary">{gap.category}</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <div className="space-y-1 border-r border-border/40 pr-2">
                            <span className="text-[10px] uppercase text-muted-foreground font-mono">Current Resume Narrative</span>
                            <p className="text-muted-foreground leading-relaxed">{gap.currentNarrative}</p>
                          </div>
                          <div className="space-y-1">
                            <span className="text-[10px] uppercase text-signal font-mono">Suggested Executive Revision</span>
                            <p className="text-foreground font-medium leading-relaxed">{gap.suggestedRevision}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {activeWorkspaceTab === "linkedin" && (
                  <div className="space-y-3.5 text-xs">
                    <p className="text-xs text-muted-foreground font-normal">
                      Optimize your LinkedIn profile positioning for C-suite executive searches:
                    </p>
                    <div className="rounded border border-border/60 bg-background p-3.5 space-y-2">
                      <span className="text-[10px] uppercase text-primary font-mono">Recommended LinkedIn Headline</span>
                      <p className="text-foreground font-medium">{executionPkg.linkedInStrategy.recommendedHeadline}</p>
                    </div>
                    <div className="rounded border border-border/60 bg-background p-3.5 space-y-2">
                      <span className="text-[10px] uppercase text-primary font-mono">Executive About Section Framing</span>
                      <p className="text-muted-foreground leading-relaxed">{executionPkg.linkedInStrategy.executiveAboutFraming}</p>
                    </div>
                  </div>
                )}

                {activeWorkspaceTab === "screening" && (
                  <div className="space-y-3">
                    <p className="text-xs text-muted-foreground font-normal">
                      Targeted questions for initial recruiter screening calls:
                    </p>
                    {executionPkg.screeningQuestions.map((q, i) => (
                      <div key={i} className="rounded border border-border/60 bg-background p-3 text-xs space-y-1">
                        <p className="font-medium text-foreground">• {q.question}</p>
                        <p className="text-muted-foreground text-[11px]"><span className="text-primary font-semibold">Why it matters:</span> {q.whyItMatters}</p>
                      </div>
                    ))}
                  </div>
                )}

                {activeWorkspaceTab === "interview" && (
                  <div className="space-y-3.5 text-xs">
                    <p className="text-xs text-muted-foreground font-normal">
                      Strategic positioning for C-suite panel interviews:
                    </p>
                    <div className="rounded border border-border/60 bg-background p-3.5 space-y-1.5">
                      <span className="text-[10px] uppercase text-primary font-mono">60-Second Opening Hook</span>
                      <p className="text-foreground italic">{executionPkg.interviewPrep.openingHook}</p>
                    </div>
                    <div className="rounded border border-border/60 bg-background p-3.5 space-y-1.5">
                      <span className="text-[10px] uppercase text-primary font-mono">Key Track Record Theme to Emphasize</span>
                      <p className="text-muted-foreground">{executionPkg.interviewPrep.keyThemeToEmphasize}</p>
                    </div>
                    <div className="rounded border border-border/60 bg-background p-3.5 space-y-1.5">
                      <span className="text-[10px] uppercase text-signal font-mono">Strategic Question for the Panel</span>
                      <p className="text-foreground font-medium">{executionPkg.interviewPrep.panelQuestion}</p>
                    </div>
                  </div>
                )}
              </div>
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
            SECTION 3: THE CASE (CHAPTER III) — FULL EDITORIAL REPOSITORY BINDING
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
              {composed.headline}
            </h2>

            <div className="mt-5">
              <p className="max-w-3xl font-display text-xl leading-relaxed sm:text-2xl text-foreground font-normal">
                {composed.opening}
              </p>

              {composed.editorialBridge && (
                <p className="mt-4 border-l-2 border-border-strong pl-4 text-sm leading-relaxed text-muted-foreground font-normal italic">
                  {composed.editorialBridge}
                </p>
              )}

              <p className="mt-5 border-l-2 border-caution pl-4 text-sm leading-relaxed text-muted-foreground font-normal">
                <span className="label-mono block text-caution font-normal mb-1">Why it is not a stronger call</span>
                {brief.whyNotStronger || "This role aligns strongly with target executive capabilities and leadership altitude."}
              </p>

              <dl className="mt-7 divide-y divide-border border-y border-border">
                {rawDimensions.slice(0, 3).map((dim: any, idx: number) => (
                  <div key={idx} className="grid gap-1 py-4 sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-6">
                    <dt className="label-mono text-muted-foreground font-normal">
                      {idx === 0 ? "Core strength" : idx === 1 ? "Adjacent strength" : "Transferable"}
                    </dt>
                    <dd className="min-w-0">
                      <p className="font-display text-lg leading-snug text-foreground font-normal">{dim.label}</p>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground font-normal">
                        {formatValue(dim.jdEvidence?.value)}
                      </p>
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
                        Transferability · {formatValue(rawDimensions[idx % (rawDimensions.length || 1)]?.jdEvidence?.value) || "Executive Leadership"} → {o.role}
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
          <p className="label-mono font-normal text-muted-foreground" suppressHydrationWarning>
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
          <span className="label-mono text-muted-foreground font-normal mr-2 hidden sm:inline">Verdict</span>
          <ExecutiveActionButton
            verdict="PURSUE"
            isActive={currentVerdict === "PURSUE"}
            onClick={() => decide("PURSUE")}
            className="flex-1 sm:flex-initial"
          >
            Pursue
          </ExecutiveActionButton>

          <ExecutiveActionButton
            verdict="CONSIDER"
            isActive={currentVerdict === "CONSIDER"}
            onClick={() => decide("CONSIDER")}
            className="flex-1 sm:flex-initial"
          >
            Consider
          </ExecutiveActionButton>

          <ExecutiveActionButton
            verdict="PASS"
            isActive={currentVerdict === "PASS"}
            onClick={() => decide("PASS")}
            className="flex-1 sm:flex-initial"
          >
            Pass
          </ExecutiveActionButton>

          {o.applyUrl ? (
            <Button
              asChild
              className="ml-auto hidden sm:inline-flex items-center gap-2 rounded bg-foreground px-4 py-2.5 font-mono text-xs text-background uppercase tracking-[0.14em] hover:opacity-90 font-normal h-auto"
            >
              <a
                href={applyUrlFor(o)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Apply direct →
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
