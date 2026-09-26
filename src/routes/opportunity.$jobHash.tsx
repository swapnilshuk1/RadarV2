import { createFileRoute, notFound, useRouter, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  type DecisionVerb,
  type ServedOpportunity,
  type EvaluatedOpportunity,
  isEvaluated,
  isUnmaterialized,
  isUnavailable,
} from "../data/opportunity-fixtures";
import { getOpportunityDetailsFn } from "../lib/intelligence/opportunity-server";
import { useDecisions } from "../lib/decisions-store";
import { resolveDossierDecisionState } from "../lib/intelligence/decision-state";
import { ReadingSurface } from "@/components/radar/opportunity/surfaces/ReadingSurface";
import { ExecutiveBriefingSurface } from "@/components/radar/opportunity/surfaces/ExecutiveBriefingSurface";
import { CanonicalDossierV2Surface } from "@/components/radar/opportunity/surfaces/CanonicalDossierV2Surface";
import { DossierView } from "@/dossier/DossierView";
import { isExternalPostingUrl } from "@/lib/acquisition/external-posting-url";

export const Route = createFileRoute("/opportunity/$jobHash")({
  loader: async ({ params, location }: { params: { jobHash: string }; location: { search: unknown } }) => {
    const raw = location.search as { tenantId?: unknown; personId?: unknown };
    const deps = { tenantId: typeof raw.tenantId === "string" ? raw.tenantId : undefined, personId: typeof raw.personId === "string" ? raw.personId : undefined };
    if (Boolean(deps.tenantId) !== Boolean(deps.personId)) throw new Error("CANDIDATE_SCOPE_INCOMPLETE");
    const details = await getOpportunityDetailsFn({ data: { jobHash: params.jobHash, ...deps } });
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
      return {
        meta: [{ title: "Brief unavailable - RADAR" }, { name: "robots", content: "noindex" }],
      };
    }
    const o = loaderData.opportunity;
    if (o.dossierPresentationV2) {
      const hero = o.dossierPresentationV2.composition.sections.hero;
      return {
        meta: [
          { title: `${o.role} at ${o.company} - RADAR Executive Dossier` },
          { name: "description", content: hero.headline || `${o.role} executive dossier` },
        ],
      };
    }
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
  const scope = Route.useSearch() as { tenantId?: string; personId?: string };
  const { decisions, decide: recordDecision } = useDecisions(scope);
  const router = useRouter();
  const waitingForReview =
    isEvaluated(o) &&
    (o.memoReviewState === "preparing" ||
      o.memoReviewState === "pending" ||
      o.memoReviewState === "withheld");
  useEffect(() => {
    if (!waitingForReview) return;
    let busy = false;
    const refresh = async () => {
      if (document.visibilityState !== "visible" || busy) return;
      busy = true;
      try {
        await router.invalidate();
      } finally {
        busy = false;
      }
    };
    const timer = setInterval(() => {
      void refresh().catch(() => {});
    }, 30_000);
    return () => clearInterval(timer);
  }, [waitingForReview, router]);

  if (isUnmaterialized(o)) {
    return (
      <div className="memo-container py-16 text-center">
        <h2 className="text-xl font-serif text-foreground mb-4">Pending Materialization</h2>
        <p className="text-muted-foreground mb-8">
          This opportunity is queued for evaluation under your active context.
        </p>
        <Link to="/" search={scope} className="text-primary hover:underline">
          Return to Shortlist
        </Link>
      </div>
    );
  }

  const dossierState = resolveDossierDecisionState(o, decisions[o.jobHash]);

  const decide = (verb: DecisionVerb) => {
    recordDecision(o.jobHash, verb, dossierState.evaluationFingerprint);
    router.invalidate();
  };

  if (isEvaluated(o) && o.richDossier) {
    return (
      <>
        <div className="memo-container flex flex-wrap items-center justify-between gap-4 py-4">
          <Link to="/" search={scope} className="text-primary hover:underline">
            Return to Shortlist
          </Link>
          <div className="flex gap-2" aria-label="Your decision">
            {(["PURSUE", "CONSIDER", "PASS"] as const).map((verb) => (
              <button
                key={verb}
                className="rounded border px-3 py-2"
                aria-pressed={dossierState.selectedActionForControls === verb}
                onClick={() => decide(verb)}
              >
                {verb}
              </button>
            ))}
          </div>
          {isExternalPostingUrl(o.applyUrl) && (
            <a
              href={o.applyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline"
            >
              View job posting
            </a>
          )}
        </div>
        <DossierView
          dossier={o.richDossier}
          reviewState={
            o.memoReviewState === "reviewed"
              ? "reviewed"
              : o.memoReviewState === "review_attention"
                ? "attention"
                : "pending"
          }
        />
      </>
    );
  }

  if (isEvaluated(o) && o.memoReviewState === "preparing") {
    return (
      <div className="memo-container py-16">
        <Link to="/" search={scope}>Return to Shortlist</Link>
        <h1 className="font-serif text-3xl mt-6">{o.role}</h1>
        <p>
          {o.company} · {o.decision}
        </p>
        <p role="status" className="mt-6">
          Evaluation complete. Your memo is being prepared.
        </p>
        <div className="flex gap-2 mt-6" aria-label="Your decision">
          {(["PURSUE", "CONSIDER", "PASS"] as const).map((verb) => (
            <button
              key={verb}
              className="rounded border px-3 py-2"
              aria-pressed={dossierState.selectedActionForControls === verb}
              onClick={() => decide(verb)}
            >
              {verb}
            </button>
          ))}
        </div>
        {isExternalPostingUrl(o.applyUrl) && (
          <a href={o.applyUrl} target="_blank" rel="noopener noreferrer">
            View job posting
          </a>
        )}
      </div>
    );
  }

  if (isEvaluated(o) && o.memoReviewState === "preparation_attention") {
    return (
      <div className="memo-container py-16">
        <Link to="/" search={scope}>Return to Shortlist</Link>
        <h1 className="font-serif text-3xl mt-6">{o.role}</h1>
        <p>
          {o.company} · {o.decision}
        </p>
        <p role="status" className="mt-6">
          Evaluation is complete, but memo preparation needs attention. Your opportunity and
          decisions remain available while the composition job is inspected or retried.
        </p>
        <div className="flex gap-2 mt-6" aria-label="Your decision">
          {(["PURSUE", "CONSIDER", "PASS"] as const).map((verb) => (
            <button
              key={verb}
              className="rounded border px-3 py-2"
              aria-pressed={dossierState.selectedActionForControls === verb}
              onClick={() => decide(verb)}
            >
              {verb}
            </button>
          ))}
        </div>
        {isExternalPostingUrl(o.applyUrl) && (
          <a href={o.applyUrl} target="_blank" rel="noopener noreferrer">
            View job posting
          </a>
        )}
      </div>
    );
  }

  if (isEvaluated(o) && o.memoReviewState === "withheld") {
    return (
      <div className="memo-container py-16">
        <Link to="/" search={scope}>Return to Shortlist</Link>
        <h1 className="font-serif text-3xl mt-6">{o.role}</h1>
        <p>
          {o.company} · {o.decision}
        </p>
        <p role="status" className="mt-6">
          The memo is temporarily unavailable while factual corrections are reviewed. Your
          opportunity and decisions are preserved.
        </p>
        {isExternalPostingUrl(o.applyUrl) && (
          <a href={o.applyUrl} target="_blank" rel="noopener noreferrer">
            View job posting
          </a>
        )}
      </div>
    );
  }

  if (o.dossierPresentationV2) {
    return (
      <CanonicalDossierV2Surface
        opportunity={o}
        presentation={o.dossierPresentationV2}
        neighbors={neighbors}
        currentIndex={currentIndex}
        totalCount={totalCount}
        decide={decide}
        dossierState={dossierState}
        scope={scope}
      />
    );
  }

  if (isUnavailable(o)) {
    return (
      <div className="memo-container py-16 text-center">
        <h2 className="text-xl font-serif text-foreground mb-4">Opportunity Unavailable</h2>
        <p className="text-muted-foreground mb-8">State: {o.evaluationState}</p>
        <Link to="/" search={scope} className="text-primary hover:underline">
          Return to Shortlist
        </Link>
      </div>
    );
  }

  if (!isEvaluated(o)) {
    return null;
  }
  const evalOpp = o;

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
            scope={scope}
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
            scope={scope}
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
        <p className="mt-2 text-muted-foreground">
          {evalOpp.company} · {evalOpp.location}
        </p>
      </header>

      <section className="memo-card space-y-3" aria-label="Canonical recommendation">
        <p className="label-mono text-muted-foreground">Engine recommendation</p>
        <p className="text-2xl font-serif text-foreground">
          {dossierState.engineVerdict ?? "Recommendation unavailable"}
        </p>
        <p className="text-sm text-muted-foreground">
          Fit index: {evalOpp.engineRecommendation?.qualityScore ?? "Unknown"}
        </p>
        <p className="text-xs font-mono text-muted-foreground">
          Evaluation: {dossierState.evaluationFingerprint ?? "Unknown"}
        </p>
        <p className="text-xs font-mono text-muted-foreground">
          Review state: {evalOpp.reviewState}
        </p>
        <p className="text-sm text-muted-foreground">
          Detailed dossier not materialized for this evaluation.
        </p>
      </section>

      <section className="memo-card space-y-3" aria-label="Your decision">
        <p className="label-mono text-muted-foreground">Your decision</p>
        <p className="text-sm text-muted-foreground">
          {dossierState.userDecision ?? "No user decision recorded"}
        </p>
        <div className="flex flex-wrap gap-2">
          {(["PURSUE", "CONSIDER", "PASS"] as DecisionVerb[]).map((verb) => (
            <button
              key={verb}
              type="button"
              onClick={() => decide(verb)}
              className="memo-badge border border-border text-foreground hover:bg-surface-raised"
            >
              {verb}
            </button>
          ))}
        </div>
      </section>

      <nav className="flex justify-between text-sm">
        {neighbors?.prev ? (
          <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.prev }} search={scope}>
            Previous
          </Link>
        ) : (
          <span />
        )}
        <span className="text-muted-foreground">
          {currentIndex} of {totalCount}
        </span>
        {neighbors?.next ? (
          <Link to="/opportunity/$jobHash" params={{ jobHash: neighbors.next }} search={scope}>
            Next
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </main>
  );
}
