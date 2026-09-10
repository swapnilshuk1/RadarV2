import { useCallback, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import type { ServedOpportunity, DecisionVerb } from "@/data/opportunity-fixtures";
import type { CanonicalDossierPresentationV2 } from "@/lib/domain/dossier_presentation";
import type { EditorialProposition, EditorialPropositionKind } from "@/lib/intelligence/editorial/EditorialPropositionComposer";
import type { DossierDecisionState } from "@/lib/intelligence/decision-state";

export interface CanonicalDossierV2SurfaceProps {
  opportunity: ServedOpportunity;
  presentation: CanonicalDossierPresentationV2;
  neighbors?: { prev: string | null; next: string | null };
  currentIndex?: number;
  totalCount?: number;
  decide: (verb: DecisionVerb) => void;
  dossierState: DossierDecisionState;
}

function PropositionBadge({ kind }: { kind: EditorialPropositionKind }) {
  switch (kind) {
    case "EMPLOYER_FACT":
      return <span className="label-mono px-2 py-0.5 rounded border border-border text-muted-foreground bg-surface-raised">PROJECTION EXTRACT</span>;
    case "CANDIDATE_FACT":
      return <span className="label-mono px-2 py-0.5 rounded border border-signal text-signal bg-surface-raised">CANDIDATE EVIDENCE</span>;
    case "CANONICAL_EVALUATION":
      return <span className="label-mono px-2 py-0.5 rounded border border-border-strong text-foreground bg-surface-raised">CANONICAL EVALUATION</span>;
    case "RADAR_INFERENCE":
      return <span className="label-mono px-2 py-0.5 rounded border border-caution text-caution bg-surface-raised">RADAR INFERENCE</span>;
    case "EVIDENCE_LIMITATION":
      return <span className="label-mono px-2 py-0.5 rounded border border-border text-muted-foreground bg-muted">EVIDENCE LIMITATION</span>;
    default:
      return <span className="label-mono px-2 py-0.5 rounded border border-border text-muted-foreground">EVIDENCE</span>;
  }
}

function PropositionItem({ prop }: { prop: EditorialProposition }) {
  return (
    <li className="space-y-1.5 py-2 border-b border-border last:border-b-0">
      <div className="flex items-center gap-2">
        <PropositionBadge kind={prop.kind} />
        {prop.roleEvidenceIds.length > 0 && (
          <span className="label-mono text-muted-foreground">
            {prop.roleEvidenceIds.length} source ref{prop.roleEvidenceIds.length > 1 ? "s" : ""}
          </span>
        )}
      </div>
      <p className="text-foreground leading-relaxed font-sans">{prop.text}</p>
    </li>
  );
}

export function CanonicalDossierV2Surface({
  opportunity: o,
  presentation,
  neighbors,
  currentIndex,
  totalCount,
  decide,
  dossierState,
}: CanonicalDossierV2SurfaceProps) {
  const comp = presentation.composition;
  const isEvaluated = presentation.evaluation.state === "EVALUATED";
  const verdict = presentation.evaluation.verdict;
  const score = presentation.evaluation.score;

  // Keyboard shortcut listener: P = Pursue, C = Consider, X = Pass
  const handleKeyboard = useCallback(
    (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key.toUpperCase()) {
        case "P":
          decide("PURSUE");
          break;
        case "C":
          decide("CONSIDER");
          break;
        case "X":
          decide("PASS");
          break;
      }
    },
    [decide]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyboard);
    return () => document.removeEventListener("keydown", handleKeyboard);
  }, [handleKeyboard]);

  return (
    <div className="min-h-screen pb-32 bg-background text-foreground font-sans">
      {/* Top Header & Navigation Breadcrumb */}
      <header className="border-b border-border bg-surface-raised py-4">
        <div className="memo-container flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              ← Return to Shortlist
            </Link>
            {currentIndex !== undefined && totalCount !== undefined && (
              <span className="label-mono text-muted-foreground">
                {currentIndex + 1} of {totalCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3">
            {o.applyUrl && (
              <a
                href={o.applyUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs font-mono uppercase tracking-wider text-muted-foreground hover:text-foreground px-3 py-1 rounded border border-border"
              >
                Direct Posting ↗
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="memo-container py-10 space-y-12">
        {/* Title, Role & Company Hero */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="label-mono px-2 py-0.5 rounded border border-border bg-surface-raised text-muted-foreground">
              {comp.compositionMode.replace(/_/g, " ")}
            </span>
            {isEvaluated && verdict && (
              <span
                className={`label-mono px-2.5 py-0.5 rounded font-semibold ${
                  verdict === "PURSUE"
                    ? "badge-pursue"
                    : verdict === "CONSIDER"
                    ? "badge-consider"
                    : "badge-pass"
                }`}
              >
                RECOMMENDATION: {verdict}
              </span>
            )}
            {isEvaluated && score !== null && (
              <span className="label-mono px-2 py-0.5 rounded border border-border text-foreground">
                FIT INDEX {score}%
              </span>
            )}
            {!isEvaluated && (
                <span className="label-mono px-2.5 py-0.5 rounded border border-caution text-caution bg-surface-raised">
                SOURCE-GROUNDED DOSSIER · EVALUATION {presentation.evaluation.state}
              </span>
            )}
          </div>

          <h1 className="text-4xl sm:text-5xl font-serif text-foreground tracking-tight leading-tight">
            {o.role}
          </h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-sm font-sans">
            <span className="font-medium text-foreground">{o.company}</span>
            <span>·</span>
            <span>{o.location}</span>
            {o.postedRelative && (
              <>
                <span>·</span>
                <span>Posted {o.postedRelative}</span>
              </>
            )}
            {o.scrapedFrom && (
              <>
                <span>·</span>
                <span>via {o.scrapedFrom}</span>
              </>
            )}
          </div>
        </section>

        {/* 1. EXECUTIVE BRIEF (Permanent Landmark) */}
        <section className="memo-opinion-box space-y-4">
          <header className="border-b border-border pb-2">
            <h2 className="label-mono text-muted-foreground tracking-widest">
              EXECUTIVE BRIEF
            </h2>
          </header>
          {comp.sections.hero.headline && (
            <h3 className="text-2xl font-serif text-foreground leading-snug">
              {comp.sections.hero.headline}
            </h3>
          )}
          {comp.sections.hero.propositions.length > 0 && (
            <ul className="space-y-3 pt-2">
              {comp.sections.hero.propositions.map((p) => (
                <PropositionItem key={p.id} prop={p} />
              ))}
            </ul>
          )}
        </section>

        {/* 2. STRATEGIC CAREER VALUE (Permanent Landmark) */}
        <section className="memo-card space-y-4">
          <header className="border-b border-border pb-2">
            <h2 className="label-mono text-muted-foreground tracking-widest">
              STRATEGIC CAREER VALUE
            </h2>
          </header>
          {comp.sections.whyAttention.headline && (
            <h3 className="text-xl font-serif text-foreground">
              {comp.sections.whyAttention.headline}
            </h3>
          )}
          {comp.sections.whyAttention.propositions.length > 0 ? (
            <ul className="space-y-2">
              {comp.sections.whyAttention.propositions.map((p) => (
                <PropositionItem key={p.id} prop={p} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic font-sans">
              No strategic career value anomalies identified in current evidence.
            </p>
          )}
        </section>

        {/* 3. THE CASE (Permanent Landmark) */}
        <section className="memo-card space-y-4">
          <header className="border-b border-border pb-2">
            <h2 className="label-mono text-muted-foreground tracking-widest">
              THE CASE
            </h2>
          </header>
          {comp.sections.bottomLine.headline && (
            <h3 className="text-xl font-serif text-foreground">
              {comp.sections.bottomLine.headline}
            </h3>
          )}
          {comp.sections.bottomLine.propositions.length > 0 ? (
            <ul className="space-y-2">
              {comp.sections.bottomLine.propositions.map((p) => (
                <PropositionItem key={p.id} prop={p} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic font-sans">
              No grounded bottom-line proposition is available for this dossier.
            </p>
          )}
        </section>

        {/* 4. THE ROLE (Permanent Landmark) */}
        <section className="memo-card space-y-4">
          <header className="border-b border-border pb-2">
            <h2 className="label-mono text-muted-foreground tracking-widest">
              THE ROLE
            </h2>
          </header>
          {comp.sections.mandate.headline && (
            <h3 className="text-xl font-serif text-foreground">
              {comp.sections.mandate.headline}
            </h3>
          )}
          {comp.sections.mandate.propositions.length > 0 ? (
            <ul className="space-y-2">
              {comp.sections.mandate.propositions.map((p) => (
                <PropositionItem key={p.id} prop={p} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic font-sans">
              No additional source-grounded role requirement is available.
            </p>
          )}
        </section>

        {/* 5. YOUR ADVANTAGE (Permanent Landmark) */}
        <section className="memo-card space-y-4">
          <header className="border-b border-border pb-2">
            <h2 className="label-mono text-muted-foreground tracking-widest">
              YOUR ADVANTAGE
            </h2>
          </header>
          {comp.sections.candidatePositioning.headline && (
            <h3 className="text-xl font-serif text-foreground">
              {comp.sections.candidatePositioning.headline}
            </h3>
          )}
          {comp.sections.candidatePositioning.propositions.length > 0 ? (
            <ul className="space-y-2">
              {comp.sections.candidatePositioning.propositions.map((p) => (
                <PropositionItem key={p.id} prop={p} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic font-sans">
              No evaluator-linked candidate evidence is available for this opportunity.
            </p>
          )}
        </section>

        {/* 6. OPEN QUESTIONS (Permanent Landmark) */}
        <section className="memo-callout space-y-4">
          <header className="border-b border-border pb-2">
            <h2 className="label-mono text-muted-foreground tracking-widest">
              OPEN QUESTIONS
            </h2>
          </header>
          {comp.sections.verify.headline && (
            <h3 className="text-xl font-serif text-foreground">
              {comp.sections.verify.headline}
            </h3>
          )}
          {comp.sections.verify.propositions.length > 0 ? (
            <ul className="space-y-2">
              {comp.sections.verify.propositions.map((p) => (
                <PropositionItem key={p.id} prop={p} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic font-sans">
              No additional verification proposition is available.
            </p>
          )}
        </section>

        {/* 7. DECISION BOUNDARIES (Permanent Landmark) */}
        <section className="memo-card space-y-4">
          <header className="border-b border-border pb-2">
            <h2 className="label-mono text-muted-foreground tracking-widest">
              DECISION BOUNDARIES
            </h2>
          </header>
          {comp.sections.howToWin.headline && (
            <h3 className="text-xl font-serif text-foreground">
              {comp.sections.howToWin.headline}
            </h3>
          )}
          {comp.sections.howToWin.propositions.length > 0 ? (
            <ul className="space-y-2">
              {comp.sections.howToWin.propositions.map((p) => (
                <PropositionItem key={p.id} prop={p} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground italic font-sans">
              No grounded positioning recommendation is available.
            </p>
          )}
        </section>

        {/* 8. SUPPORTING EVIDENCE (Permanent Landmark) */}
        <section className="memo-card space-y-4">
          <header className="border-b border-border pb-2 flex items-center justify-between">
            <h2 className="label-mono text-muted-foreground tracking-widest">
              SUPPORTING EVIDENCE
            </h2>
            <span className="label-mono text-muted-foreground">
              {comp.propositions.length} TOTAL PROPOSITIONS
            </span>
          </header>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm font-sans pt-2">
            <div className="p-3 bg-surface-raised rounded border border-border space-y-1">
              <span className="label-mono text-muted-foreground">Coverage Breakdown</span>
              <ul className="text-xs space-y-1 text-foreground">
                <li>Role Mandate Extracted: {comp.coverage.hasRoleMandate ? "Yes" : "No"}</li>
                <li>Qualifications Extracted: {comp.coverage.hasQualifications ? "Yes" : "No"}</li>
                <li>Candidate Positioning: {comp.coverage.hasCandidatePositioning ? "Yes" : "No"}</li>
                <li>Evaluation Signals: {comp.coverage.hasCanonicalEvaluation ? "Yes" : "No"}</li>
              </ul>
            </div>
            <div className="p-3 bg-surface-raised rounded border border-border space-y-1">
              <span className="label-mono text-muted-foreground">Provenance Counts</span>
              <ul className="text-xs space-y-1 text-foreground">
                <li>Employer Facts: {comp.propositions.filter((p) => p.kind === "EMPLOYER_FACT").length}</li>
                <li>Candidate Facts: {comp.propositions.filter((p) => p.kind === "CANDIDATE_FACT").length}</li>
                <li>Evaluations: {comp.propositions.filter((p) => p.kind === "CANONICAL_EVALUATION").length}</li>
                <li>Limitations / Inferences: {comp.propositions.filter((p) => p.kind === "RADAR_INFERENCE" || p.kind === "EVIDENCE_LIMITATION").length}</li>
              </ul>
            </div>
          </div>
        </section>

        {/* 9. DOSSIER LEDGER (Permanent Landmark) */}
        <section className="memo-card space-y-4">
          <header className="border-b border-border pb-2">
            <h2 className="label-mono text-muted-foreground tracking-widest">
              DOSSIER LEDGER
            </h2>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <tbody>
                <tr className="border-b border-border">
                  <td className="py-2 text-muted-foreground w-1/3">TENANT ID</td>
                  <td className="py-2 text-foreground">{presentation.identity.tenantId}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 text-muted-foreground">PERSON ID</td>
                  <td className="py-2 text-foreground">{presentation.identity.personId}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 text-muted-foreground">CANONICAL JOB ID</td>
                  <td className="py-2 text-foreground">{presentation.identity.canonicalJobId}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 text-muted-foreground">OPPORTUNITY VERSION</td>
                  <td className="py-2 text-foreground">{presentation.identity.opportunityVersion}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 text-muted-foreground">CONTEXT FINGERPRINT</td>
                  <td className="py-2 text-foreground">{presentation.identity.evaluationContextFingerprint}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 text-muted-foreground">EVALUATION FINGERPRINT</td>
                  <td className="py-2 text-foreground">{presentation.evaluation.fingerprint || "NONE (SOURCE-ONLY)"}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className="py-2 text-muted-foreground">PRESENTATION VERSION</td>
                  <td className="py-2 text-foreground">{presentation.schemaVersion} ({presentation.editorialVersion})</td>
                </tr>
                <tr>
                  <td className="py-2 text-muted-foreground">MATERIALIZED AT</td>
                  <td className="py-2 text-foreground">{presentation.generatedAt}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>

      {/* Floating Action Dock (Apple/Linear Style) */}
      <div className="floating-dock justify-between gap-4 pointer-events-auto">
        {/* Left: Previous Brief */}
        <div className="flex items-center gap-1.5 min-w-[70px]">
          {neighbors?.prev ? (
            <Link
              to="/opportunity/$jobHash"
              params={{ jobHash: neighbors.prev }}
              className="dock-link"
            >
              ← PREV
            </Link>
          ) : (
            <span className="dock-link opacity-30 cursor-not-allowed">← PREV</span>
          )}
        </div>

        {/* Center: Verdict Buttons with Keyboard Badges */}
        <div className="flex items-center gap-2">
          <span className="dock-label">Verdict</span>

          <button
            onClick={() => decide("PURSUE")}
            className={`dock-btn transition-all shadow-xs ${
              dossierState.selectedActionForControls === "PURSUE"
                ? "bg-emerald-600 text-white font-semibold"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            Pursue
            <kbd>P</kbd>
          </button>

          <button
            onClick={() => decide("CONSIDER")}
            className={`dock-btn transition-all shadow-xs ${
              dossierState.selectedActionForControls === "CONSIDER"
                ? "bg-amber-600 text-white font-semibold"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            Consider
            <kbd>C</kbd>
          </button>

          <button
            onClick={() => decide("PASS")}
            className={`dock-btn transition-all shadow-xs ${
              dossierState.selectedActionForControls === "PASS"
                ? "bg-foreground text-background font-semibold"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            Pass
            <kbd>X</kbd>
          </button>
        </div>

        {/* Right: Next Brief */}
        <div className="flex items-center gap-1.5 min-w-[70px] justify-end">
          {neighbors?.next ? (
            <Link
              to="/opportunity/$jobHash"
              params={{ jobHash: neighbors.next }}
              className="dock-link"
            >
              NEXT →
            </Link>
          ) : (
            <span className="dock-link opacity-30 cursor-not-allowed">NEXT →</span>
          )}
        </div>
      </div>
    </div>
  );
}
