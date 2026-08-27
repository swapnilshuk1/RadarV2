import { createFileRoute, notFound, useRouter } from "@tanstack/react-router";
import { type DecisionVerb } from "../data/opportunity-fixtures";
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
  head: ({ loaderData }: { loaderData?: any }) => {
    if (!loaderData) {
      return { meta: [{ title: "Brief unavailable — RADAR" }, { name: "robots", content: "noindex" }] };
    }
    const o = loaderData.opportunity;
    const engineVerdict = o.engineRecommendation?.engineVerdict || "DOSSIER";
    return {
      meta: [
        { title: `${engineVerdict} · ${o.role} — RADAR Executive Dossier` },
        { name: "description", content: o.recommendation || "Executive advisory dossier" },
      ],
    };
  },
  component: OpportunityBriefView,
});

import { resolveDossierDecisionState } from "../lib/intelligence/decision-state";

function OpportunityBriefView() {
  const { opportunity: o, neighbors, currentIndex, totalCount } = Route.useLoaderData();
  const { decisions, decide: recordDecision } = useDecisions();
  const router = useRouter();

  const dossierState = resolveDossierDecisionState(o, decisions[o.jobHash]);

  const decide = (verb: DecisionVerb) => {
    recordDecision(
      o.jobHash,
      verb,
      dossierState.evaluationFingerprint
    );
    router.invalidate();
  };

  const brief = BriefCompositionEngine.compose(o, { bypassHistory: true });
  const jobProj = JobProjectionBuilder.build(o);
  
  // Real candidate projection built dynamically using the canonical builder and candidate profile
  const candidateProj = new CandidateProjectionBuilderImpl().fromProfile(candidateProfile);
  
  const capEval = CapabilityAssessmentEngine.evaluate(candidateProj, jobProj);
  const executionPkg = ExecutionEngine.validateDecision(candidateProj, jobProj);
  const rawDimensions = o.dimensions || (o as any).evidenceDimensions || [];

  const surfaceProps = {
    opportunity: o,
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

export function getFocusTopic(o: any, jobProj: any): string {
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

  if (o?.domain && typeof o.domain === "string" && o.domain.length < 40) {
    return `${o.domain.toLowerCase()} expansion`;
  }

  return "commercial growth and market expansion";
}
