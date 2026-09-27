import { Link } from "@tanstack/react-router";
import type { DecisionVerb, EvaluatedOpportunity } from "../../data/opportunity-fixtures";
import { applicationActionFor } from "../../data/opportunity-fixtures";
/** Renders staged-v8 feed truth plus the optional reviewed rich dossier. */
export function InlineBrief({ opportunity: o, dossier, onDecide }: {
  opportunity: EvaluatedOpportunity;
  dossier?: EvaluatedOpportunity;
  onDecide: (verb: DecisionVerb) => void;
}) {
  const applicationAction = applicationActionFor(o);
  const persistedThesis = dossier?.richDossier?.executiveThesis.text;
  const track = o.mandateArchetype ?? null;
  const engineVerdict = o.engineRecommendation?.engineVerdict ?? "UNKNOWN";
  const screening = o.engineRecommendation?.screeningViability;
  const userDecision = o.userDecision?.userAction ?? "NONE";
  const effectiveDecision = o.effectiveDecision ?? engineVerdict;

  return <div className="grid gap-6 border border-border/80 dark:border-amber-900/30 rounded-lg bg-[#FAF8F3] dark:bg-[#231E1A] shadow-xs p-4 sm:p-6 my-1 lg:grid-cols-12 items-stretch">
    <div className="lg:col-span-7 flex flex-col justify-between min-w-0 space-y-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 pb-1"><span className="label-mono font-medium text-muted-foreground text-[0.68rem]">◆ Executive brief</span><span className="font-display text-base text-primary font-normal">{engineVerdict}</span></div>
        {persistedThesis ? <p className="mt-2 font-display text-xl sm:text-2xl leading-snug text-foreground font-normal">{persistedThesis}</p> : <p className="mt-2 text-sm leading-relaxed text-muted-foreground">A reviewed detailed memo is not available for this evaluation yet.</p>}
      </div>
    </div>
    <div className="lg:col-span-5 flex flex-col justify-between min-w-0 border-t border-border/60 pt-4 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0 space-y-4">
      <div><span className="label-mono text-[0.68rem] font-bold text-muted-foreground uppercase block pb-1">Mandate Ledger</span><dl className="mt-1.5 space-y-2 border-t border-border/50 pt-2.5">
        {track && <div className="flex items-baseline justify-between gap-3"><dt className="label-mono text-[0.65rem] text-muted-foreground">Track</dt><dd className="truncate font-mono text-[0.7rem] text-foreground font-medium">{track}</dd></div>}
        <div className="flex items-baseline justify-between gap-3"><dt className="label-mono text-[0.65rem] text-muted-foreground">Source</dt><dd className="truncate font-mono text-[0.7rem] text-foreground font-medium">{o.scrapedFrom}</dd></div>
        <div className="flex items-baseline justify-between gap-3"><dt className="label-mono text-[0.65rem] text-muted-foreground">Screening</dt><dd className="truncate font-mono text-[0.7rem] text-foreground font-medium">{screening ? screening.toLowerCase() : "See evaluation"}</dd></div>
        <div className="flex items-baseline justify-between gap-3"><dt className="label-mono text-[0.65rem] text-muted-foreground">Effective decision</dt><dd className="truncate font-mono text-[0.7rem] text-foreground font-medium">{effectiveDecision}</dd></div>
        <div className="flex items-baseline justify-between gap-3"><dt className="label-mono text-[0.65rem] text-muted-foreground">Your decision</dt><dd className="truncate font-mono text-[0.7rem] text-foreground font-medium">{userDecision}</dd></div>
      </dl></div>
      <div className="space-y-3 pt-2"><div className="flex items-center gap-2"><Link to="/opportunity/$jobHash" params={{ jobHash: o.jobHash }} className="flex-1 flex items-center justify-center rounded-full bg-foreground px-3 py-2 label-mono text-background text-xs font-bold transition-opacity hover:opacity-90 cursor-pointer shadow-xs" onClick={(e) => e.stopPropagation()}>Open full dossier ↗</Link>{applicationAction && <a href={applicationAction.url} target="_blank" rel="noreferrer" className="px-3.5 py-2 rounded-full border border-border/60 font-mono text-xs text-foreground hover:bg-muted font-semibold cursor-pointer" onClick={(e) => e.stopPropagation()}>{applicationAction.label}</a>}</div>
        <div className="grid grid-cols-3 gap-1.5">{(["PURSUE", "CONSIDER", "PASS"] as const).map((verb) => <button key={verb} type="button" onClick={(e) => { e.stopPropagation(); onDecide(verb); }} className="rounded-sm border border-border py-2 px-1 text-center font-mono text-[0.68rem] uppercase font-medium text-muted-foreground transition-colors hover:bg-muted cursor-pointer tracking-wider">{verb[0]}{verb.slice(1).toLowerCase()}</button>)}</div>
      </div>
    </div>
  </div>;
}
