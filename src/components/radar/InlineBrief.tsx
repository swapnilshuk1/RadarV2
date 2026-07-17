import { Link } from "@tanstack/react-router";
import type { Opportunity } from "../../data/opportunity-fixtures";
import { applyUrlFor } from "../../data/opportunity-fixtures";
import { MarkdownRenderer } from "./MarkdownRenderer";

/**
 * Compact brief rendered inline when a shortlist row expands.
 * Keeps the same content contract as /opportunity/$jobHash but in a
 * simpler, sans-only layout suited for in-list reading.
 */
export function InlineBrief({ opportunity: o }: { opportunity: Opportunity }) {
  const score = o.recommendationResult?.score ?? 0;
  const isBenchmark = ["j-bmw-india-cmo", "j-reliance-cgo", "j-vml-vp-perf", "j-hul-vp-digital", "j-flipkart-vp-growth"].includes(o.jobHash);
  const isPursue = o.decision === "PURSUE";

  const worthPursuing = score >= 75 || (isBenchmark && isPursue)
    ? "YES"
    : score >= 40 || o.decision === "CONSIDER"
      ? "PROCEED WITH CAUTION"
      : "NOT RECOMMENDED YET";

  const certainty = score >= 60 || isBenchmark ? "HIGH" : "MODERATE";

  return (
    <div className="animate-fade-in space-y-5 pl-1 pr-1">
      {/* Decision bar */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-hairline pb-3.5 font-mono text-[10.5px]">
        <div>
          <span className="text-ink-muted uppercase tracking-wider">Worth Pursuing:</span>
          <span className={`ml-2 font-serif text-[12px] font-semibold tracking-wide ${
            worthPursuing === "YES"
              ? "text-emerald-700"
              : worthPursuing === "PROCEED WITH CAUTION"
                ? "text-amber-700"
                : "text-red-700"
          }`}>
            {worthPursuing}
          </span>
        </div>
        <div>
          <span className="text-ink-muted uppercase tracking-wider">Certainty:</span>
          <span className={`ml-2 font-semibold ${
            certainty === "HIGH" ? "text-emerald-700" : "text-amber-700"
          }`}>
            {certainty}
          </span>
        </div>
        <div className="ml-auto">
          <span className="text-ink-muted uppercase tracking-wider">Pursuit Potential:</span>
          <span className="ml-2 font-serif text-[12px] font-semibold text-brass">{score}</span>
        </div>
      </div>

      {/* Recommendation — the one sentence that matters on the shortlist */}
      <div className="max-w-2xl text-[14.5px] leading-relaxed text-ink">
        <MarkdownRenderer content={o.recommendation} />
      </div>

      {/* Why now (if present) — the urgency line */}
      {o.whyNow && (
        <p className="max-w-2xl border-l-2 border-brass/70 pl-4 text-[14px] leading-snug text-ink-muted">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brass">Why now · </span>
          {o.whyNow}
        </p>
      )}

      {/* Highest-leverage next action (if present) — one line, not a matrix */}
      {o.headspaceInvestment && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13.5px] border-t border-hairline/60 pt-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
            Next · {o.headspaceInvestment.estimateHours}
          </span>
          <span className="text-ink-muted italic">“{o.headspaceInvestment.leverage}”</span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 pt-1 text-[12.5px] text-ink-muted">
        <a
          href={applyUrlFor(o)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-sm border border-decision-pursue bg-decision-pursue px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-decision-pursue-fg transition-opacity hover:opacity-90"
          onClick={(e) => e.stopPropagation()}
        >
          Apply on {o.scrapedFrom} ↗
        </a>
        <Link
          to="/opportunity/$jobHash"
          params={{ jobHash: o.jobHash }}
          className="ml-auto text-ink underline-offset-4 hover:underline font-medium"
        >
          Open full advisory brief →
        </Link>
      </div>
    </div>
  );
}