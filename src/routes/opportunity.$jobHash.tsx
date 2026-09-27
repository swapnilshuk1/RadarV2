import { createFileRoute, notFound, useRouter, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  type DecisionVerb,
  isEvaluated,
  isUnmaterialized,
  isUnavailable,
} from "../data/opportunity-fixtures";
import { getOpportunityDetailsFn, requestDetailedDossierFn, requestFactualVerificationFn } from "../lib/intelligence/opportunity-server";
import { useDecisions } from "../lib/decisions-store";
import { resolveDossierDecisionState } from "../lib/intelligence/decision-state";
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
  const [decisionStatus, setDecisionStatus] = useState<string | null>(null);
  const [decisionPending, setDecisionPending] = useState(false);
  const [dossierRequestPending, setDossierRequestPending] = useState(false);
  const [verificationRequestPending, setVerificationRequestPending] = useState(false);
  const waitingForReview =
    isEvaluated(o) &&
    (o.memoReviewState === "preparing" ||
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

  const decide = async (verb: DecisionVerb) => {
    setDecisionPending(true);
    setDecisionStatus(null);
    try {
      await recordDecision(o.jobHash, verb, dossierState.evaluationFingerprint);
      await router.invalidate();
      setDecisionStatus(`Your decision is saved as ${verb}.`);
    } catch {
      setDecisionStatus("RADAR could not save your decision. Please try again.");
    } finally {
      setDecisionPending(false);
    }
  };

  const requestDetailedDossier = async () => {
    setDossierRequestPending(true);
    setDecisionStatus(null);
    try {
      const result = await requestDetailedDossierFn({ data: { jobHash: o.jobHash, ...scope } });
      setDecisionStatus(
        result.state === "QUEUED_EVALUATION"
          ? "GLM evaluation has been queued. RADAR will prepare the dossier after evaluation completes."
          : result.state === "QUEUED_DOSSIER"
            ? "Detailed dossier preparation has been queued. Gemini verification follows the draft."
            : result.state === "QUEUED_GEMINI_REVIEW"
              ? "The GLM draft exists. Gemini factual verification is queued."
              : result.state === "ALREADY_COMPLETED"
                ? "The reviewed detailed dossier is already available."
                : "This PASS evaluation does not require a detailed dossier.",
      );
      await router.invalidate();
    } catch (error) {
      setDecisionStatus(error instanceof Error ? error.message : "RADAR could not queue the detailed dossier.");
    } finally {
      setDossierRequestPending(false);
    }
  };

  const requestFactualVerification = async () => {
    setVerificationRequestPending(true);
    setDecisionStatus(null);
    try {
      const result = await requestFactualVerificationFn({ data: { jobHash: o.jobHash, ...scope } });
      setDecisionStatus(
        result.state === "QUEUED_GEMINI_REVIEW"
          ? "Gemini factual verification has been queued for this GLM draft."
          : result.state === "QUEUED_DOSSIER"
            ? "The GLM detailed dossier is being prepared before Gemini verification."
            : result.state === "QUEUED_EVALUATION"
              ? "GLM evaluation has been queued before detailed dossier preparation."
              : result.state === "ALREADY_COMPLETED"
                ? "This dossier has already completed Gemini factual verification."
                : "This PASS evaluation does not require a detailed dossier.",
      );
      await router.invalidate();
    } catch (error) {
      setDecisionStatus(error instanceof Error ? error.message : "RADAR could not queue Gemini factual verification.");
    } finally {
      setVerificationRequestPending(false);
    }
  };

  const decisionFeedback = decisionStatus ? (
    <p role="status" className="memo-container py-2 text-sm text-muted-foreground">{decisionStatus}</p>
  ) : null;

  if (isEvaluated(o) && o.richDossier) {
    return (
      <>
        {decisionFeedback}
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
                disabled={decisionPending}
                onClick={() => void decide(verb)}
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
        {decisionFeedback}
        <Link to="/" search={scope}>Return to Shortlist</Link>
        <h1 className="font-serif text-3xl mt-6">{o.role}</h1>
        <p>
          {o.company} · {o.decision}
        </p>
        <p role="status" className="mt-6">
          Evaluation complete. Your memo is being prepared.
        </p>
        <button
          type="button"
          disabled={verificationRequestPending}
          onClick={() => void requestFactualVerification()}
          className="mt-4 rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          {verificationRequestPending ? "Requesting…" : "Request Gemini factual verification"}
        </button>
        <div className="flex gap-2 mt-6" aria-label="Your decision">
          {(["PURSUE", "CONSIDER", "PASS"] as const).map((verb) => (
            <button
              key={verb}
              className="rounded border px-3 py-2"
              aria-pressed={dossierState.selectedActionForControls === verb}
              disabled={decisionPending}
              onClick={() => void decide(verb)}
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
        {decisionFeedback}
        <Link to="/" search={scope}>Return to Shortlist</Link>
        <h1 className="font-serif text-3xl mt-6">{o.role}</h1>
        <p>
          {o.company} · {o.decision}
        </p>
        <p role="status" className="mt-6">
          Evaluation is complete, but memo preparation needs attention. Your opportunity and
          decisions remain available while the composition job is inspected or retried.
        </p>
        <button
          type="button"
          disabled={dossierRequestPending}
          onClick={() => void requestDetailedDossier()}
          className="mt-4 rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          {dossierRequestPending ? "Requesting…" : "Request detailed dossier"}
        </button>
        <div className="flex gap-2 mt-6" aria-label="Your decision">
          {(["PURSUE", "CONSIDER", "PASS"] as const).map((verb) => (
            <button
              key={verb}
              className="rounded border px-3 py-2"
              aria-pressed={dossierState.selectedActionForControls === verb}
              disabled={decisionPending}
              onClick={() => void decide(verb)}
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
        <button
          type="button"
          disabled={verificationRequestPending}
          onClick={() => void requestFactualVerification()}
          className="mt-4 rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
        >
          {verificationRequestPending ? "Requesting…" : "Request Gemini factual verification"}
        </button>
        {isExternalPostingUrl(o.applyUrl) && (
          <a href={o.applyUrl} target="_blank" rel="noopener noreferrer">
            View job posting
          </a>
        )}
      </div>
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

  if (o.decision === "PASS" || o.engineRecommendation?.engineVerdict === "PASS") {
    return (
      <main className="memo-container py-10 space-y-6">
        {decisionFeedback}
        <Link to="/" search={scope} className="text-primary hover:underline">
          Return to Shortlist
        </Link>
        <header className="border-b border-border pb-6">
          <h1 className="mt-2 font-serif text-4xl text-foreground">{o.role}</h1>
          <p className="mt-2 text-muted-foreground">{o.company} ? {o.location}</p>
        </header>
        <section className="memo-card space-y-3" aria-label="RADAR recommendation">
          <p className="label-mono text-muted-foreground">RADAR recommendation</p>
          <p className="text-2xl font-serif text-foreground">PASS</p>
          <p className="text-sm text-muted-foreground">
            Evaluation is complete. PASS opportunities stop here; no detailed dossier or Gemini review is generated.
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
                onClick={() => void decide(verb)}
                disabled={decisionPending}
                className="memo-badge border border-border text-foreground hover:bg-surface-raised disabled:opacity-50"
              >
                {verb}
              </button>
            ))}
          </div>
        </section>
        {isExternalPostingUrl(o.applyUrl) && (
          <a href={o.applyUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            View job posting
          </a>
        )}
      </main>
    );
  }

  return (
    <main className="memo-container py-10 space-y-6">
      {decisionFeedback}
      <Link to="/" search={scope} className="text-primary hover:underline">
        Return to Shortlist
      </Link>
      <header className="border-b border-border pb-6">
        <h1 className="mt-2 font-serif text-4xl text-foreground">{o.role}</h1>
        <p className="mt-2 text-muted-foreground">{o.company} ? {o.location}</p>
      </header>
      <section className="memo-card space-y-3" aria-label="Dossier pipeline attention">
        <p className="label-mono text-muted-foreground">Dossier pipeline attention</p>
        <p className="text-xl font-serif text-foreground">{dossierState.engineVerdict ?? o.decision}</p>
        <p role="status" className="text-sm text-muted-foreground">
          Evaluation is complete, but no current staged-v8 dossier state is available. Retry the current dossier or Gemini review path; RADAR will not fall back to an older presentation.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={dossierRequestPending}
            onClick={() => void requestDetailedDossier()}
            className="rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
          >
            {dossierRequestPending ? "Requesting?" : "Retry detailed dossier"}
          </button>
          <button
            type="button"
            disabled={verificationRequestPending}
            onClick={() => void requestFactualVerification()}
            className="rounded border border-border px-3 py-2 text-sm text-foreground hover:bg-muted disabled:opacity-50"
          >
            {verificationRequestPending ? "Requesting?" : "Retry Gemini verification"}
          </button>
        </div>
      </section>
    </main>
  );
}
