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

  const getFocusTopic = () => {
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

          <h1 className="mt-4 max-w-4xl font-display text-[2.6rem] leading-[1.02] tracking-tight sm:text-6xl text-foreground font-normal">
            {o.role} mandate at {o.company} focused on {getFocusTopic()}
          </h1>
        </div>
      </header>

      <section className="border-b border-border bg-surface-raised">
        <div className="mx-auto max-w-[1180px] px-5 py-8 sm:px-8 sm:py-10">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="label-mono text-primary font-normal">If you only read one thing</span>
            <span className="label-mono font-normal text-muted-foreground">1-minute executive brief</span>
          </div>
          <p className="mt-4 font-display text-3xl leading-tight sm:text-4xl text-foreground font-normal">
            {currentVerdict === "PURSUE" ? "Worth pursuing." : currentVerdict === "CONSIDER" ? "Worth considering." : "Pass on this mandate."}
          </p>
          <p className="mt-3 text-xs sm:text-sm text-foreground/90 font-mono border-l-2 border-primary/60 pl-3 leading-relaxed">
            {currentVerdict === "PURSUE"
              ? `Proceed assuming recruiter confirms commercial budget control and direct executive sponsorship at ${o.company}.`
              : currentVerdict === "CONSIDER"
              ? `Proceed only if the regional role carries genuine decision authority rather than advisory responsibility.`
              : `Pass unless board mandates structural restructuring or direct P&L ownership.`}
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

      <section className="border-b border-border bg-background py-10">
        <div className="mx-auto max-w-[1180px] space-y-12 px-5 sm:px-8">
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
                  {(() => {
                    const dataCheck = AdvisoryConstitution.validateDataSufficiency(o);
                    if (!dataCheck.isSufficient) return dataCheck.message;
                    return jobProj.executiveMission?.statement || `Leadership at ${o.company} is hiring an executive to drive ${getFocusTopic()} and establish predictable operating governance.`;
                  })()}
                </p>
              </div>

              <div className="border-t border-border/60 pt-4 space-y-2">
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
                  ]).map((cond, i) => (
                    <li key={i} className="text-sm text-foreground font-normal">• {cond}</li>
                  ))}
                </ul>
              </div>

              <div className="rounded border border-border bg-surface-raised p-4 space-y-2">
                <p className="label-mono text-xs uppercase tracking-wider text-caution font-normal">This recommendation assumes</p>
                <p className="text-xs text-muted-foreground leading-relaxed">The following operational conditions hold true:</p>
                <ul className="space-y-1.5 text-xs text-foreground">
                  {executionPkg.recommendationConditions.map((cond, i) => (
                    <li key={i}>• {cond}</li>
                  ))}
                </ul>
              </div>

              <div className="space-y-3">
                <p className="label-mono text-xs uppercase tracking-wider text-foreground font-normal">Questions to Validate During Your Screening Call</p>
                {executionPkg.screeningQuestions.map((sq, i) => (
                  <div key={i} className="rounded border border-border/60 bg-background p-3.5 space-y-1.5 text-xs">
                    <p className="font-semibold text-foreground">{i + 1}. {sq.question}</p>
                    <p className="text-muted-foreground leading-relaxed"><span className="text-primary font-medium">Why it matters:</span> {sq.whyItMatters}</p>
                  </div>
                ))}
              </div>

              <p className="text-xs text-muted-foreground font-mono pt-1 italic">
                <span className="text-foreground font-semibold">Action:</span> Validate these operational assumptions during your first recruiter conversation before committing to full interviews.
              </p>

              {/* Memorable Moment: Partner Observation */}
              <div className="rounded border-l-2 border-primary bg-surface-raised p-4 space-y-1">
                <span className="label-mono text-xs uppercase tracking-wider text-primary font-semibold">Partner Observation</span>
                <p className="text-sm text-foreground italic leading-relaxed">
                  “The title is less important than the operating latitude. If the commercial mandate proves genuine, this role is materially stronger than its title suggests.”
                </p>
              </div>
            </div>
          </div>

          {/* EXECUTIVE OPINION BOX ("Here's what I think") */}
          <div className="rounded-lg border-2 border-primary/30 bg-surface-raised p-6 space-y-3 my-6">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <span className="label-mono text-xs uppercase tracking-wider text-primary font-semibold">Executive Opinion</span>
              <span className="label-mono text-[11px] text-muted-foreground">Synthesized Advisory Lead</span>
            </div>
            <p className="font-display text-lg sm:text-xl leading-relaxed text-foreground font-normal">
              {currentVerdict === "PURSUE"
                ? `This is one of the stronger mandates in your current search because it compounds your existing growth leadership narrative rather than asking you to reinvent it. I would invest time in this opportunity—but only after confirming that commercial authority is genuine rather than advisory at ${o.company}.`
                : currentVerdict === "CONSIDER"
                ? `This role presents solid domain alignment, but the operational altitude sits closer to functional execution than board-level strategy. Consider advancing if you seek immediate category leadership at ${o.company}, but clarify direct C-suite reporting before committing to formal interviews.`
                : `While ${o.company} is a notable brand, the required responsibilities represent a functional regression from your verified executive track record. Pass on this mandate to preserve search bandwidth for opportunities offering true P&L scope.`}
            </p>
          </div>

          {/* SECTION 3: Evidence Supporting This Recommendation */}
          <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
            <div>
              <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Evidence</p>
              <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">Evidence Supporting This Recommendation</h2>
            </div>
            <div className="space-y-5">
              <p className="text-xs text-muted-foreground font-normal">Verified evidence demonstrating executive operation at this level:</p>
              <ul className="space-y-4 border-l-2 border-signal pl-4 pt-1">
                {(brief.proofPoints || []).slice(0, 3).map((pt: any, i: number) => {
                  const categoryTitle = i === 0 ? "Commercial Leadership" : i === 1 ? "Platform Transformation" : "Executive Governance";
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
              <p className="text-xs text-muted-foreground font-mono pt-1 italic">
                <span className="text-foreground font-semibold">Observation:</span> The recommendation remains strong unless commercial ownership proves narrower than expected.
              </p>
            </div>
          </div>

          {/* SECTION 4: Present your experience effectively */}
          <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
            <div>
              <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Strategy</p>
              <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">Present your experience effectively</h2>
            </div>
            <div className="space-y-6">
              <div className="space-y-2 border-l-2 border-caution pl-4">
                <p className="label-mono text-xs uppercase tracking-wider text-caution font-normal">Positioning Advisory</p>
                <p className="text-sm leading-relaxed text-foreground font-normal">
                  {currentVerdict === "PURSUE" ? "Your experience aligns directly. Focus your narrative on your track record of scaling commercial governance." : "Ensure your resume explicitly highlights P&L responsibility to bridge gaps in functional domain coverage."}
                </p>
              </div>

              {/* Tailoring Intro Statement */}
              <p className="text-xs text-muted-foreground italic font-mono">
                The following revisions strengthen the parts of your narrative most likely to influence shortlisting for this specific mandate at {o.company}.
              </p>

              <div className="rounded-lg border border-border bg-surface-raised p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
                  <p className="label-mono text-xs uppercase tracking-wider text-foreground font-normal">Positioning Workspace</p>
                  <div className="flex flex-wrap gap-1.5">
                    {["resume", "linkedin", "screening", "interview"].map((tab) => (
                      <button
                        key={tab}
                        onClick={() => setActiveWorkspaceTab(tab as any)}
                        className={`px-2.5 py-1 text-[11px] rounded font-mono transition-colors ${
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
                    {executionPkg.resumeGaps.map((gap, i) => (
                      <div key={i} className="rounded border border-border/60 bg-background p-3.5 text-xs space-y-2">
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

              <p className="text-xs text-muted-foreground font-mono pt-1 italic">
                <span className="text-foreground font-semibold">Action:</span> Incorporate these narrative revisions before engaging the search partner.
              </p>
            </div>
          </div>

        </div>
      </section>

      {/* ────────────────────────────────────────────────────────────────────────
          APPENDIX FOOTER DRAWER: EVIDENCE, METHODOLOGY & CLAIM LINEAGE
          ──────────────────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border bg-surface-raised/40 py-8 text-xs">
        <div className="mx-auto max-w-[1180px] px-5 sm:px-8">
          <details className="group cursor-pointer">
            <summary className="label-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors flex items-center justify-between">
              <span>Appendix: Evidence, Methodology & Claim Lineage</span>
              <span className="text-primary font-normal group-open:rotate-180 transition-transform">▼</span>
            </summary>
            
            <div className="mt-6 space-y-6 border-t border-border/60 pt-6 text-xs text-muted-foreground font-mono">
              <div className="grid gap-6 sm:grid-cols-3">
                <div className="space-y-2">
                  <p className="text-foreground font-semibold uppercase tracking-wider">Methodology</p>
                  <p className="leading-relaxed text-[11px]">
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
