import { createFileRoute, notFound, useRouter, Link } from "@tanstack/react-router";
import { type DecisionVerb, type ServedOpportunity, type EvaluatedOpportunity, isEvaluated, isUnmaterialized, isUnavailable } from "../data/opportunity-fixtures";
import { getOpportunityDetailsFn } from "../lib/intelligence/opportunity-server";
import { ClientOpportunityCache } from "../lib/opportunity-cache";
import { useDecisions } from "../lib/decisions-store";
import { candidateProfile } from "../data/candidate-profile";
import { BriefCompositionEngine } from "../lib/intelligence/editorial/BriefCompositionEngine";
import { JobProjectionBuilder } from "../lib/intelligence/builders/JobProjectionBuilder";
import { CandidateProjectionBuilderImpl } from "../lib/intelligence/builders/CandidateProjectionBuilder";
import { CapabilityAssessmentEngine } from "../lib/intelligence/engines/CapabilityAssessmentEngine";
import { ExecutionEngine } from "../lib/intelligence/engines/ExecutionEngine";
import { ReadingSurface } from "@/components/radar/opportunity/surfaces/ReadingSurface";
import { ExecutiveBriefingSurface } from "@/components/radar/opportunity/surfaces/ExecutiveBriefingSurface";
import { resolveDossierDecisionState } from "../lib/intelligence/decision-state";

export const Route = createFileRoute("/opportunity/$jobHash")({
  loader: async ({ params }: { params: { jobHash: string } }) => {
    // Check client-side opportunity cache first (instant 0ms navigation on cache hit)
    const cachedDetails = ClientOpportunityCache.getDetails(params.jobHash);
    if (cachedDetails && cachedDetails.opportunity) {
      return cachedDetails;
    }

    const details = await getOpportunityDetailsFn({ data: params.jobHash });
    if (!details.opportunity) throw notFound();
    return {
      opportunity: details.opportunity,
      neighbors: details.neighbors,
      currentIndex: details.currentIndex,
      totalCount: details.totalCount,
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) {
      return { meta: [{ title: "Brief unavailable - RADAR" }, { name: "robots", content: "noindex" }] };
    }
    const o = loaderData.opportunity;
    if (!isEvaluated(o)) {
      return { meta: [{ title: `${o.evaluationState} - RADAR Dossier` }] };
    }
    const engineVerdict = o.engineRecommendation?.engineVerdict || "DOSSIER";
    return {
      meta: [
        { title: `${engineVerdict} : ${o.role} - RADAR Executive Dossier` },
        { name: "description", content: o.recommendation || "Executive advisory dossier" },
      ],
    };
  },
  component: OpportunityBriefView,
});

export function OpportunityBriefView() {
  const { opportunity, neighbors, currentIndex, totalCount } = Route.useLoaderData();
  const o = opportunity;
  const { decisions, decide: recordDecision } = useDecisions();
  const router = useRouter();

  if (isUnmaterialized(o)) {
    return (
      <div className="memo-container py-16 text-center">
        <h2 className="text-xl font-serif text-foreground mb-4">Pending Materialization</h2>
        <p className="text-muted-foreground mb-8">This opportunity is queued for evaluation under your active context.</p>
        <Link to="/" className="text-primary hover:underline">Return to Shortlist</Link>
      </div>
    );
  }

  if (isUnavailable(o)) {
    return (
      <div className="memo-container py-16 text-center">
        <h2 className="text-xl font-serif text-foreground mb-4">Opportunity Unavailable</h2>
        <p className="text-muted-foreground mb-8">State: {o.evaluationState}</p>
        <Link to="/" className="text-primary hover:underline">Return to Shortlist</Link>
      </div>
    );
  }
  
  if (!isEvaluated(o)) { return null; }
  const evalOpp = o;
  const dossierState = resolveDossierDecisionState(evalOpp, decisions[evalOpp.jobHash]);

  const decide = (verb: DecisionVerb) => {
    recordDecision(
      evalOpp.jobHash,
      verb,
      dossierState.evaluationFingerprint
    );
    router.invalidate();
  };

  const brief = BriefCompositionEngine.compose(evalOpp, { bypassHistory: true });
  const jobProj = JobProjectionBuilder.build(evalOpp);
  
  const candidateProj = new CandidateProjectionBuilderImpl().fromProfile(candidateProfile);
  
  const capEval = CapabilityAssessmentEngine.evaluate(candidateProj, jobProj);
  const executionPkg = ExecutionEngine.validateDecision(candidateProj, jobProj);
  const rawDimensions = evalOpp.dimensions || [];

  const surfaceProps = {
    opportunity: evalOpp,
    brief,
    dossierState,
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

export function getFocusTopic(o: EvaluatedOpportunity, jobProj: any): string {
  if (jobProj?.trueExecutiveMandate) {
    const mandateMap: Record<string, string> = {
      COMMERCIAL_EXPANSION: "commercial growth & market expansion",
      TRANSFORMATION: "digital & operational transformation",
      TURNAROUND: "operational restructuring & revenue repair",
      GOVERNANCE: "pipeline & platform governance",
      SCALE_UP: "scaling GTM infrastructure",
    };
    if (mandateMap[jobProj.trueExecutiveMandate]) {
      return mandateMap[jobProj.trueExecutiveMandate];
    }
  }

  if (o?.mandateArchetype && typeof o.mandateArchetype === "string" && o.mandateArchetype.length < 40) {
    return o.mandateArchetype.toLowerCase();
  }

  const coreCap = jobProj?.capabilities?.find((c: any) => c.importance === "Core" || c.confidence > 0.7);
  if (coreCap && coreCap.name && coreCap.name.length < 40) {
    return coreCap.name.toLowerCase();
  }

  const optAny = o as any;
  if (optAny?.domain && typeof optAny.domain === "string" && optAny.domain.length < 40) {
    return `${optAny.domain.toLowerCase()} expansion`;
  }

  return "commercial growth and market expansion";
}
