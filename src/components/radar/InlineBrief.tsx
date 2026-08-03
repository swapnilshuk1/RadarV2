import { Link } from "@tanstack/react-router";
import type { Opportunity } from "../../data/opportunity-fixtures";
import { applyUrlFor } from "../../data/opportunity-fixtures";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { PreviewCompositionEngine } from "../../lib/intelligence/editorial/PreviewCompositionEngine";

/**
 * Compact brief rendered inline when a shortlist row expands.
 * Answers the executive question: "Is this worth opening right now?"
 * Avoids dashboard aesthetics in favor of authoritative editorial components.
 */
export function InlineBrief({ opportunity: o }: { opportunity: Opportunity }) {
  const preview = PreviewCompositionEngine.compose(o);

  return (
    <div className="animate-fade-in border-t border-border/60 px-4 sm:px-10 pb-8 sm:pb-10 pt-6 sm:pt-8 mt-4 sm:mt-6 mb-2 bg-card/60 rounded-b-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-border/40 pb-4 mb-8">
        <div className="mono text-[11px] tracking-[0.22em] font-bold text-foreground uppercase">
          ◆ EXECUTIVE BRIEF
        </div>
        <div className="font-serif text-[1.25rem] font-medium text-emerald-800">
          Worth pursuing.
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[1.6fr_1fr] items-stretch">
        <div className="flex flex-col justify-between space-y-6">
          <div>
            <h3 className="font-serif text-[22px] sm:text-[26px] leading-snug font-light text-foreground mb-3">
              {preview.headline || "Closest match to your operating mandate."}
            </h3>
            <p className="text-[14.5px] leading-relaxed text-muted-foreground font-normal">
              {preview.narrative}
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 pt-2">
            <div className="bg-card border border-border/80 border-l-4 border-l-emerald-700 p-4.5 sm:p-5 rounded-sm shadow-2xs flex flex-col justify-between">
              <div className="mono text-[10px] tracking-[0.2em] text-emerald-800 font-bold uppercase mb-2">
                PROCEED IF
              </div>
              <p className="text-[13.5px] leading-relaxed text-foreground font-serif">
                {preview.whyItWorks || o.primaryDriver || "Scope and strategic fit align with your target mandate."}
              </p>
            </div>

            <div className="bg-card border border-border/80 border-l-4 border-l-amber-700 p-4.5 sm:p-5 rounded-sm shadow-2xs flex flex-col justify-between">
              <div className="mono text-[10px] tracking-[0.2em] text-amber-800 font-bold uppercase mb-2">
                PAUSE IF
              </div>
              <p className="text-[13.5px] leading-relaxed text-foreground font-serif">
                {preview.watchFor}
              </p>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border/80 p-6 rounded-sm shadow-2xs flex flex-col justify-between space-y-6">
          <div>
            <div className="mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase font-bold border-b border-border/40 pb-2 mb-3">
              WATCH FOR
            </div>
            <p className="text-[13.5px] leading-relaxed text-foreground font-normal">
              {preview.watchFor}
            </p>
          </div>

          <div className="pt-4 border-t border-border/60 space-y-2.5">
            <div className="mono text-[10px] tracking-[0.2em] text-muted-foreground uppercase font-bold mb-2">
              NEXT STEP
            </div>
            <Link
              to="/opportunity/$jobHash"
              params={{ jobHash: o.jobHash }}
              className="mono inline-flex items-center justify-center gap-2 border border-foreground bg-foreground px-4 py-2.5 text-[11px] font-bold text-background transition-opacity hover:opacity-85 uppercase tracking-wider rounded-sm w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <span>OPEN FULL DOSSIER</span>
              <span className="font-sans text-[14px]">↗</span>
            </Link>

            <a
              href={applyUrlFor(o)}
              target="_blank"
              rel="noopener noreferrer"
              className="mono block text-center text-[10.5px] text-muted-foreground underline decoration-border underline-offset-4 transition-colors hover:text-foreground font-medium pt-1"
              onClick={(e) => e.stopPropagation()}
            >
              Apply directly on {o.scrapedFrom}
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}