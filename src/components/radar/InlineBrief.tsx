import { Link } from "@tanstack/react-router";
import type { Opportunity, DecisionVerb } from "../../data/opportunity-fixtures";
import { applyUrlFor } from "../../data/opportunity-fixtures";
import { PreviewCompositionEngine } from "../../lib/intelligence/editorial/PreviewCompositionEngine";

export function InlineBrief({
  opportunity: o,
  onDecide,
}: {
  opportunity: Opportunity;
  onDecide: (verb: DecisionVerb) => void;
}) {
  const preview = PreviewCompositionEngine.compose(o);

  return (
    <div className="grid gap-8 border border-border/80 rounded-md bg-card shadow-[0_2px_12px_rgba(0,0,0,0.03)] px-5 py-7 sm:px-8 my-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      {/* Left Column: Executive Narrative & Drivers */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="label-mono font-normal text-muted-foreground">◆ Executive brief</span>
          <span className="font-display text-lg text-primary font-normal">
            {o.decision === "PURSUE" ? "Worth pursuing." : o.decision === "CONSIDER" ? "Worth considering." : "Pass on mandate."}
          </span>
        </div>

        <p className="mt-4 max-w-xl font-display text-[1.6rem] leading-[1.25] sm:text-3xl text-foreground font-normal">
          {preview.headline || "Closest match to your operating mandate."}
        </p>

        <div className="mt-6 grid gap-5 sm:grid-cols-2">
          <div className="border-l-2 border-signal pl-4">
            <p className="label-mono text-signal font-normal">Proceed if</p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground font-normal">
              {preview.whyItWorks || o.primaryDriver || "Direct P&L ownership aligned to your marketing strategy precedents."}
            </p>
          </div>

          <div className="border-l-2 border-caution pl-4">
            <p className="label-mono text-caution font-normal">Pause if</p>
            <p className="mt-1.5 text-sm leading-relaxed text-foreground font-normal">
              {preview.watchFor || "Standard organizational alignment review."}
            </p>
          </div>
        </div>
      </div>

      {/* Right Column: Metadata & Actions */}
      <div className="min-w-0 border-t border-border pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
        <p className="label-mono font-normal text-muted-foreground">Watch for</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground font-normal">
          {preview.watchFor || "Compensation target or reporting hierarchy requires verification."}
        </p>

        <dl className="mt-5 space-y-2 border-t border-border pt-4">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="label-mono font-normal">Target</dt>
            <dd className="truncate font-mono text-xs text-foreground font-normal">
              {(o as any).compensation || (o as any).targetRemuneration || "Confidential Executive Compensation"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="label-mono font-normal">Track</dt>
            <dd className="truncate font-mono text-xs text-foreground font-normal">
              {o.mandateArchetype || "Growth Marketing"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="label-mono font-normal">Source</dt>
            <dd className="truncate font-mono text-xs text-foreground font-normal">
              {o.scrapedFrom || "LinkedIn"}
            </dd>
          </div>
        </dl>

        <p className="label-mono mt-6 font-normal">Next step</p>
        <Link
          to="/opportunity/$jobHash"
          params={{ jobHash: o.jobHash }}
          className="mt-2 flex items-center justify-center rounded-[4px] bg-foreground px-4 py-3 font-mono text-[0.68rem] tracking-[0.18em] uppercase text-background font-normal transition-opacity hover:opacity-90 w-full cursor-pointer"
          onClick={(e) => e.stopPropagation()}
        >
          Open full dossier ↗
        </Link>

        <a
          href={applyUrlFor(o)}
          target="_blank"
          rel="noreferrer"
          className="mt-2 block text-center font-mono text-[0.68rem] text-muted-foreground underline underline-offset-4 hover:text-foreground font-normal"
          onClick={(e) => e.stopPropagation()}
        >
          Apply directly on {o.scrapedFrom || "LinkedIn"}
        </a>

        <div className="mt-5 grid grid-cols-3 gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDecide("PURSUE");
            }}
            className="rounded-[4px] border border-signal/40 px-2 py-2 font-mono text-[0.6rem] tracking-[0.14em] uppercase text-signal font-normal transition-colors hover:bg-signal/10 cursor-pointer"
          >
            Pursue
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDecide("CONSIDER");
            }}
            className="rounded-[4px] border border-caution/40 px-2 py-2 font-mono text-[0.6rem] tracking-[0.14em] uppercase text-caution font-normal transition-colors hover:bg-caution/10 cursor-pointer"
          >
            Consider
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDecide("PASS");
            }}
            className="rounded-[4px] border border-border px-2 py-2 font-mono text-[0.6rem] tracking-[0.14em] uppercase text-muted-foreground font-normal transition-colors hover:bg-muted cursor-pointer"
          >
            Pass
          </button>
        </div>
      </div>
    </div>
  );
}