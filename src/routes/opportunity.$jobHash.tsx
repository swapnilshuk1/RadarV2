import { createFileRoute, notFound, useRouter, Link } from "@tanstack/react-router";
import { type DecisionVerb, type ServedOpportunity, type EvaluatedOpportunity, isEvaluated, isUnmaterialized, isUnavailable } from "../data/opportunity-fixtures";
import { getOpportunityDetailsFn } from "../lib/intelligence/opportunity-server";
import { useDecisions } from "../lib/decisions-store";
import { resolveDossierDecisionState } from "../lib/intelligence/decision-state";
import { ReadingSurface } from "@/components/radar/opportunity/surfaces/ReadingSurface";
import { ExecutiveBriefingSurface } from "@/components/radar/opportunity/surfaces/ExecutiveBriefingSurface";

export const Route = createFileRoute("/opportunity/$jobHash")({
  loader: async ({ params }: { params: { jobHash: string } }) => {
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

  const presentation = evalOpp.dossierPresentation;
  if (presentation) {
    return (
      <>
        <div className="hidden lg:block">
          <ReadingSurface
            opportunity={evalOpp}
            brief={presentation.brief}
            dossierState={dossierState}
            decide={decide}
            neighbors={neighbors}
            currentIndex={currentIndex}
            totalCount={totalCount}
            jobProj={presentation.jobProjection}
            executionPkg={presentation.executionPackage}
            rawDimensions={[...presentation.rawDimensions]}
            generatedAt={presentation.evaluatedAt ?? presentation.generatedAt}
            evaluatedAt={presentation.evaluatedAt}
            focusTopic={presentation.focusTopic}
            whyRoleExists={presentation.whyRoleExists}
          />
        </div>
        <div className="lg:hidden">
          <ExecutiveBriefingSurface
            opportunity={evalOpp}
            brief={presentation.brief}
            dossierState={dossierState}
            decide={decide}
            neighbors={neighbors}
            currentIndex={currentIndex}
            totalCount={totalCount}
            jobProj={presentation.jobProjection}
            executionPkg={presentation.executionPackage}
            whyRoleExists={presentation.whyRoleExists}
          />
        </div>
      </>
    );
  }

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
        <p className="text-sm text-muted-foreground">Detailed dossier not materialized for this evaluation.</p>
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
