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

  return (
    <div className="grid gap-5 border border-border/80 dark:border-amber-900/30 rounded-lg bg-[#FAF8F3] dark:bg-[#231E1A] shadow-xs px-4 py-4 sm:px-6 my-1 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      {/* Left Column: Executive Narrative & Drivers */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label-mono font-medium text-muted-foreground text-[0.68rem]">◆ Executive brief</span>
          <span className="font-display text-base text-primary font-normal">
            {o.decision === "PURSUE" ? "Worth pursuing." : o.decision === "CONSIDER" ? "Worth considering." : "Pass on mandate."}
          </span>
        </div>

        {o.reviewWorkflowState === "REVIEWED_UNKNOWN" && (
          <div className="mt-2 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <div className="flex items-center gap-1.5 font-mono text-[0.68rem] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              HISTORICAL DECISION · V4 ASSESSMENT READY
            </div>
            <p className="mt-1 text-muted-foreground font-sans">
              Decision recorded prior to V4 intelligence calibration. Review the updated mandate analysis and confirm your posture.
            </p>
          </div>
        )}

        <p className="mt-2 max-w-xl font-display text-2xl leading-[1.25] text-foreground font-normal">
          {preview.headline || "Closest match to your operating mandate."}
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="border-l-2 border-emerald-500 pl-3">
            <p className="label-mono text-emerald-600 dark:text-emerald-400 font-bold text-[0.68rem] uppercase">Proceed if</p>
            <p className="mt-1 text-xs leading-relaxed text-foreground font-normal">
              {preview.whyItWorks || o.primaryDriver || "Direct P&L ownership aligned to your marketing strategy precedents."}
            </p>
          </div>

          <div className="border-l-2 border-amber-500 pl-3">
            <p className="label-mono text-amber-600 dark:text-amber-400 font-bold text-[0.68rem] uppercase">Pause if</p>
            <p className="mt-1 text-xs leading-relaxed text-foreground font-normal">
              {preview.watchFor || "Standard organizational alignment review."}
            </p>
          </div>
        </div>
      </div>

      {/* Right Column: Metadata & Actions */}
      <div className="min-w-0 border-t border-border/60 pt-3 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0">
        <p className="label-mono text-[0.68rem] font-bold text-muted-foreground uppercase">Watch for</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground font-normal">
          {preview.watchFor || "Compensation target or reporting hierarchy requires verification."}
        </p>

        <dl className="mt-3 space-y-1.5 border-t border-border/60 pt-2.5">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="label-mono text-[0.65rem] text-muted-foreground">Target</dt>
            <dd className="truncate font-mono text-[0.7rem] text-foreground font-medium">
              {(o as any).compensation || (o as any).targetRemuneration || "Confidential Executive Compensation"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="label-mono text-[0.65rem] text-muted-foreground">Track</dt>
            <dd className="truncate font-mono text-[0.7rem] text-foreground font-medium">
              {o.mandateArchetype && o.mandateArchetype !== "Growth Marketing" ? o.mandateArchetype : inferExecutiveMandateArchetype(o.role, (o as any).rawText || (o as any).description)}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="label-mono text-[0.65rem] text-muted-foreground">Source</dt>
            <dd className="truncate font-mono text-[0.7rem] text-foreground font-medium">
              {o.scrapedFrom || "LinkedIn"}
            </dd>
          </div>
        </dl>

        <div className="mt-3 flex items-center gap-2">
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
            className="px-3 py-2 rounded-full border border-border/60 font-mono text-xs text-foreground hover:bg-muted font-semibold cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          >
            Apply direct
          </a>
        </div>

        <div className="mt-5 grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDecide("PURSUE");
            }}
            className="rounded-sm border border-signal/40 px-2 py-2 label-mono text-signal font-normal transition-colors hover:bg-signal/10 cursor-pointer text-center truncate"
          >
            {o.reviewWorkflowState === "REVIEWED_UNKNOWN" ? "Confirm Pursue" : "Pursue"}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDecide("CONSIDER");
            }}
            className="rounded-sm border border-caution/40 px-2 py-2 label-mono text-caution font-normal transition-colors hover:bg-caution/10 cursor-pointer text-center truncate"
          >
            {o.reviewWorkflowState === "REVIEWED_UNKNOWN" ? "Adjust to Consider" : "Consider"}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDecide("PASS");
            }}
            className="rounded-sm border border-border px-2 py-2 label-mono text-muted-foreground font-normal transition-colors hover:bg-muted cursor-pointer text-center truncate"
          >
            Pass
          </button>
        </div>
      </div>
    </div>
  );
}