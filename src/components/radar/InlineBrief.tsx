import { Link } from "@tanstack/react-router";
import type { Opportunity, DecisionVerb } from "../../data/opportunity-fixtures";
import { applyUrlFor } from "../../data/opportunity-fixtures";
import { PreviewCompositionEngine } from "../../lib/intelligence/editorial/PreviewCompositionEngine";
import { inferExecutiveMandateArchetype } from "../../lib/intelligence/editorial";

export function InlineBrief({
  opportunity: o,
  onDecide,
}: {
  opportunity: Opportunity;
  onDecide: (verb: DecisionVerb) => void;
}) {
  const preview = PreviewCompositionEngine.compose(o);
  const trackName = o.mandateArchetype && o.mandateArchetype !== "Growth Marketing" 
    ? o.mandateArchetype 
    : inferExecutiveMandateArchetype(o.role, (o as any).rawText || (o as any).description);
  const comp = (o as any).compensation || (o as any).targetRemuneration || "Confidential Executive Compensation";
  const source = o.scrapedFrom || "LinkedIn";

  return (
    <div className="grid gap-6 border border-border/80 dark:border-amber-900/30 rounded-lg bg-[#FAF8F3] dark:bg-[#231E1A] shadow-xs p-4 sm:p-6 my-1 lg:grid-cols-12 items-stretch">
      {/* Left Column (7 cols): Executive Narrative & Proceed/Pause Drivers */}
      <div className="lg:col-span-7 flex flex-col justify-between min-w-0 space-y-4">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
            <span className="label-mono font-medium text-muted-foreground text-[0.68rem]">◆ Executive brief</span>
            <span className="font-display text-base text-primary font-normal">
              {o.decision === "PURSUE" ? "Worth pursuing." : o.decision === "CONSIDER" ? "Worth considering." : "Pass on mandate."}
            </span>
          </div>

          <p className="mt-2 font-display text-xl sm:text-2xl leading-snug text-foreground font-normal">
            {preview.headline || "Closest match to your operating mandate."}
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 pt-2">
          <div className="border-l-2 border-emerald-500 bg-emerald-500/[0.04] p-3 rounded-r-md">
            <p className="label-mono text-emerald-600 dark:text-emerald-400 font-bold text-[0.68rem] uppercase">Proceed if</p>
            <p className="mt-1 text-xs leading-relaxed text-foreground font-normal">
              {preview.whyItWorks || o.primaryDriver || "Direct P&L ownership aligned to your executive track record."}
            </p>
          </div>

          <div className="border-l-2 border-amber-500 bg-amber-500/[0.04] p-3 rounded-r-md">
            <p className="label-mono text-amber-600 dark:text-amber-400 font-bold text-[0.68rem] uppercase">Pause if</p>
            <p className="mt-1 text-xs leading-relaxed text-foreground font-normal">
              {preview.watchFor || "Standard organizational alignment review."}
            </p>
          </div>
        </div>
      </div>

      {/* Right Column (5 cols): Mandate Details & Actions */}
      <div className="lg:col-span-5 flex flex-col justify-between min-w-0 border-t border-border/60 pt-4 lg:border-t-0 lg:border-l lg:pl-6 lg:pt-0 space-y-4">
        <div>
          <span className="label-mono text-[0.68rem] font-bold text-muted-foreground uppercase block pb-1">
            Mandate Ledger
          </span>

          <dl className="mt-1.5 space-y-2 border-t border-border/50 pt-2.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="label-mono text-[0.65rem] text-muted-foreground">Target</dt>
              <dd className="truncate font-mono text-[0.7rem] text-foreground font-medium">
                {comp}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="label-mono text-[0.65rem] text-muted-foreground">Track</dt>
              <dd className="truncate font-mono text-[0.7rem] text-foreground font-medium">
                {trackName}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="label-mono text-[0.65rem] text-muted-foreground">Source</dt>
              <dd className="truncate font-mono text-[0.7rem] text-foreground font-medium">
                {source}
              </dd>
            </div>
          </dl>
        </div>

        <div className="space-y-3 pt-2">
          <div className="flex items-center gap-2">
            <Link
              to="/opportunity/$jobHash"
              params={{ jobHash: o.jobHash }}
              className="flex-1 flex items-center justify-center rounded-full bg-foreground px-3 py-2 label-mono text-background text-xs font-bold transition-opacity hover:opacity-90 cursor-pointer shadow-xs"
              onClick={(e) => e.stopPropagation()}
            >
              Open full dossier ↗
            </Link>

            <a
              href={applyUrlFor(o)}
              target="_blank"
              rel="noreferrer"
              className="px-3.5 py-2 rounded-full border border-border/60 font-mono text-xs text-foreground hover:bg-muted font-semibold cursor-pointer"
              onClick={(e) => e.stopPropagation()}
            >
              Apply direct
            </a>
          </div>

          <div className="grid grid-cols-3 gap-1.5">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDecide("PURSUE");
              }}
              className="rounded-sm border border-signal/40 py-2 px-1 text-center font-mono text-[0.68rem] uppercase font-semibold text-signal transition-colors hover:bg-signal/10 cursor-pointer tracking-wider"
            >
              Pursue
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDecide("CONSIDER");
              }}
              className="rounded-sm border border-caution/40 py-2 px-1 text-center font-mono text-[0.68rem] uppercase font-semibold text-caution transition-colors hover:bg-caution/10 cursor-pointer tracking-wider"
            >
              Consider
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onDecide("PASS");
              }}
              className="rounded-sm border border-border py-2 px-1 text-center font-mono text-[0.68rem] uppercase font-medium text-muted-foreground transition-colors hover:bg-muted cursor-pointer tracking-wider"
            >
              Pass
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}