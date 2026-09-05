import { createFileRoute, notFound, useRouter, Link } from "@tanstack/react-router";
import { type DecisionVerb, type ServedOpportunity, type EvaluatedOpportunity, isEvaluated, isUnmaterialized, isUnavailable } from "../data/opportunity-fixtures";
import { getOpportunityDetailsFn } from "../lib/intelligence/opportunity-server";
import { ClientOpportunityCache } from "../lib/opportunity-cache";
import { useDecisions } from "../lib/decisions-store";
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

  return (
    <main className="memo-container py-10 space-y-8">
      <header className="border-b border-border pb-6">
        <p className="label-mono text-muted-foreground">Canonical evaluation dossier</p>
        <h1 className="mt-2 font-serif text-4xl text-foreground">{evalOpp.role}</h1>
        <p className="mt-2 text-muted-foreground">{evalOpp.company} · {evalOpp.location}</p>
      </header>

      <section className="memo-card space-y-3" aria-label="Canonical recommendation">
        <p className="label-mono text-muted-foreground">Engine recommendation</p>
        <p className="text-2xl font-serif text-foreground">{dossierState.engineVerdict ?? "Recommendation unavailable"}</p>
        <p className="text-sm text-muted-foreground">Fit index: {evalOpp.engineRecommendation?.qualityScore ?? "Unknown"}</p>
        <p className="text-xs font-mono text-muted-foreground">Evaluation: {dossierState.evaluationFingerprint ?? "Unknown"}</p>
        <p className="text-xs font-mono text-muted-foreground">Review state: {evalOpp.reviewState}</p>
      </section>

      <section className="memo-card space-y-3" aria-label="Your decision">
        <p className="label-mono text-muted-foreground">Your decision</p>
        <p className="text-sm text-muted-foreground">{dossierState.userDecision ?? "No user decision recorded"}</p>
        <div className="flex flex-wrap gap-2">
          {(["PURSUE", "CONSIDER", "PASS"] as DecisionVerb[]).map((verb) => (
            <button key={verb} type="button" onClick={() => decide(verb)} className="memo-badge border border-border text-foreground hover:bg-surface-raised">
              {verb}
            </button>
          ))}
        </div>
      </section>

      <nav className="flex justify-between text-sm">
        {neighbors?.prev ? <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.prev }}>Previous</Link> : <span />}
        <span className="text-muted-foreground">{currentIndex} of {totalCount}</span>
        {neighbors?.next ? <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.next }}>Next</Link> : <span />}
      </nav>
    </main>
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
