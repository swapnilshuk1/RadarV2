import { Link } from "@tanstack/react-router";
import { getFocusTopic } from "@/routes/opportunity.$jobHash";

import type { DossierDecisionState } from "@/lib/intelligence/decision-state";

interface HeroProps {
  o: any;
  brief: any;
  dossierState: DossierDecisionState;
  currentIndex: number;
  totalCount: number;
  jobProj: any;
  readTime?: string;
}

export function Hero({
  o,
  brief,
  dossierState,
  currentIndex,
  totalCount,
  jobProj,
  readTime,
}: HeroProps) {
  const focusTopic = getFocusTopic(o, jobProj);

  return (
    <header className="border-b border-border bg-background">
      <div className="memo-container py-8 sm:py-9">
        {/* Nav Sub-Header */}
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="label-mono hover:text-foreground transition-colors font-normal">
            ← Shortlist
          </Link>
          <span className="label-mono font-normal text-muted-foreground">
            Brief {String(currentIndex).padStart(2, "0")} of {totalCount}
          </span>
        </div>

        <div className="mt-7 grid gap-8 lg:grid-cols-[1.35fr_1fr] lg:gap-10 items-start">
          {/* Left Column: Strategic Mandate & Core Advisory Thesis */}
          <div className="space-y-5 sm:space-y-6">
            {/* Primary Decision & Score Badges */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Primary RADAR Engine Recommendation Badge (Strict Fail-Closed) */}
              {dossierState.engineVerdict ? (
                <span className={`label-mono rounded px-2 py-1 leading-none uppercase font-bold text-xs ${
                  dossierState.engineVerdict === "PURSUE"
                    ? "bg-signal text-white"
                    : dossierState.engineVerdict === "CONSIDER"
                    ? "bg-caution text-white"
                    : "bg-muted text-muted-foreground"
                }`}>
                  {dossierState.engineVerdict}
                </span>
              ) : (
                <span className="label-mono rounded px-2 py-1 leading-none uppercase font-bold text-xs bg-caution/20 text-caution border border-caution/30">
                  RECOMMENDATION UNAVAILABLE
                </span>
              )}

              {/* Subordinate User Choice Badge */}
              {dossierState.userDecisionState !== "NONE" && dossierState.userDecision && (
                <span className={`label-mono text-xs px-2 py-1 rounded font-medium ${
                  dossierState.userDecisionState === "STALE"
                    ? "bg-caution/20 text-caution border border-caution/30"
                    : dossierState.userDecisionState === "UNVERIFIABLE"
                    ? "bg-surface-raised border border-border text-muted-foreground"
                    : "bg-surface-raised border border-border text-foreground font-semibold"
                }`}>
                  YOU CHOSE: {dossierState.userDecision}
                  {dossierState.userDecisionState === "STALE" && " · STALE — RE-EVALUATED"}
                  {dossierState.userDecisionState === "UNVERIFIABLE" && " · FRESHNESS UNVERIFIED"}
                </span>
              )}

              <span className="label-mono text-xs font-semibold px-2 py-1 rounded bg-surface-raised border border-border text-foreground">
                RADAR SCORE: {(brief.qualityScore ?? o.engineRecommendation?.qualityScore ?? brief.editorialContext?.rawScore) != null ? `${brief.qualityScore ?? o.engineRecommendation?.qualityScore ?? brief.editorialContext?.rawScore}/100` : "N/A"}
              </span>

              {/* Canonical Career-Value Signal Badge */}
              {(brief.explanation?.careerValueSignal || brief.executiveThesis?.careerValueSignal) && (
                <span className="label-mono text-xs px-2 py-0.5 rounded bg-caution/20 text-caution font-medium border border-caution/30 uppercase tracking-wider">
                  {brief.explanation?.careerValueSignal || brief.executiveThesis?.careerValueSignal}
                </span>
              )}
            </div>

            {/* Secondary Operational Metadata Row */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {/* Freshness Badge */}
              <span className="label-mono text-xs px-2 py-0.5 rounded bg-surface-raised border border-border text-muted-foreground font-medium">
                {o.postedRelative ? `${o.postedRelative} · ${o.scrapedFrom || 'Workday'}` : `Scraped ${o.scrapedAt ? 'recently' : 'via ' + (o.scrapedFrom || 'Portal')}`}
              </span>

              {/* Compensation Badge */}
              <span className={`label-mono text-xs px-2 py-0.5 rounded font-medium border ${
                o.salaryBounds?.min || o.salaryBounds?.max
                  ? "bg-signal/15 text-signal border-signal/30"
                  : o.benchmarkEstimate
                  ? "bg-caution/15 text-caution border-caution/30"
                  : "bg-surface-raised text-muted-foreground border-border"
              }`}>
                {o.salaryBounds?.min || o.salaryBounds?.max
                  ? `Disclosed: ₹${((o.salaryBounds.min || 0)/100000).toFixed(0)}L – ₹${((o.salaryBounds.max || 0)/100000).toFixed(0)}L`
                  : o.benchmarkEstimate
                  ? `Market Est: ${o.benchmarkEstimate.display}`
                  : "Salary Not Disclosed"}
              </span>

              <span className="label-mono font-normal text-muted-foreground">· {brief.fitLabel || 'Executive Fit'}</span>
              <span className="label-mono font-normal text-muted-foreground">· {brief.evidenceQuality}</span>
              {readTime && <span className="label-mono font-normal text-muted-foreground">· {readTime}</span>}
            </div>

            {/* Stale Posting Warning Callout (if posting age > 45 days) */}
            {o.postedRelative && (o.postedRelative.includes("47 days") || o.postedRelative.includes("2 months") || o.isStale) && (
              <div className="memo-callout border-l-2 border-caution bg-caution/10 p-3 text-xs text-foreground font-mono">
                ⚠️ <span className="font-semibold">Opportunity Freshness Notice:</span> Posted {o.postedRelative} — verify that the role is still active before investing heavily.
              </div>
            )}

            <h1 className="font-display text-3xl sm:text-4xl leading-[1.18] tracking-tight text-foreground font-normal">
              {o.role} mandate at {o.company} focused on {focusTopic}
            </h1>

            {/* Structured Metadata Strip */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-foreground">
              {o.company && <span className="font-medium text-foreground">{o.company}</span>}
              {o.location && (
                <>
                  <span className="text-muted-foreground/60 select-none">·</span>
                  <span>{o.location}</span>
                </>
              )}
              {o.scrapedFrom && (
                <>
                  <span className="text-muted-foreground/60 select-none">·</span>
                  <span>Source: {o.scrapedFrom}</span>
                </>
              )}
              {o.compensationBand && (
                <>
                  <span className="text-muted-foreground/60 select-none">·</span>
                  <span className="text-foreground font-medium">{o.compensationBand}</span>
                </>
              )}
            </div>

            {/* High-Altitude Strategic Thesis (The Decision Partner's Core Insight) */}
            <div className="border-t border-border pt-4 space-y-2">
              <p className="label-mono text-xs text-primary font-normal uppercase tracking-wider">Executive Advisory Thesis</p>
              <p className="font-serif text-xl sm:text-2xl italic leading-relaxed text-foreground font-normal">
                “{brief.executiveThesis?.primaryReason || brief.executiveOpinion || "Evaluating strategic executive alignment..."}”
              </p>
            </div>
          </div>

          {/* Right Column: Instant Action Card */}
          <div className="memo-card bg-surface-raised p-5 sm:p-6 border border-border space-y-4">
            <div className="flex items-baseline justify-between gap-2 border-b border-border pb-2.5">
              <span className="label-mono text-primary font-normal">Verdict Overview</span>
              <span className="label-mono font-normal text-muted-foreground">1-Minute TL;DR</span>
            </div>
            
            <p className="font-display text-xl sm:text-2xl leading-snug text-foreground font-normal">
              {brief.pursuitStrategy?.bottomLine || brief.explanation?.bottomLine || brief.oneMinuteTLDR?.bottomLine}
            </p>
            
            <div className="text-xs leading-relaxed text-foreground font-mono border-l-2 border-primary pl-3 py-1 space-y-1 bg-surface-raised">
              <p className="font-semibold uppercase tracking-wider text-[0.65rem] text-primary">
                {brief.pursuitStrategy?.executiveLabel || "Advisory Strategy"}
              </p>
              <p className="text-muted-foreground">
                {brief.pursuitStrategy?.immediateNextAction || brief.verdictGuidance?.actionNotice}
              </p>
            </div>

            <div className="space-y-3 pt-2 border-t border-border">
              {brief.oneMinuteTLDR?.whyPursue && brief.oneMinuteTLDR.whyPursue.length > 0 && (
                <div className="space-y-1">
                  <p className="label-mono text-signal font-normal tracking-wider">Why this fits</p>
                  <ul className="space-y-1">
                    {brief.oneMinuteTLDR.whyPursue.slice(0, 2).map((item: string, i: number) => (
                      <li key={i} className="text-xs leading-relaxed text-muted-foreground font-normal">
                        • {item}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {brief.oneMinuteTLDR?.watchFor && brief.oneMinuteTLDR.watchFor.length > 0 && (
                <div className="space-y-1">
                  <p className="label-mono text-caution font-normal tracking-wider">What to verify</p>
                  <ul className="space-y-1">
                    {brief.oneMinuteTLDR.watchFor.slice(0, 1).map((item: string, i: number) => (
                      <li key={i} className="text-xs leading-relaxed text-muted-foreground font-normal flex items-start gap-1">
                        <span className="text-caution font-bold">•</span>
                        <span>{item.replace(/^(Strategic|Execution|Market) Risk:\s*/i, '')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
