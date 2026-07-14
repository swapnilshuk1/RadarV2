import { Link } from "@tanstack/react-router";
import type { Opportunity } from "../../data/opportunity-fixtures";
import { applyUrlFor } from "../../data/opportunity-fixtures";

/**
 * Compact brief rendered inline when a shortlist row expands.
 * Keeps the same content contract as /opportunity/$jobHash but in a
 * simpler, sans-only layout suited for in-list reading.
 */
export function InlineBrief({ opportunity: o }: { opportunity: Opportunity }) {
  return (
    <div className="animate-fade-in space-y-6 pl-1 pr-1">
      {/* Recommendation — the one sentence that matters on the shortlist */}
      <p className="max-w-2xl text-[18px] leading-snug tracking-[-0.005em] text-ink">
        {o.recommendation}
      </p>

      {/* Why now (if present) — the urgency line */}
      {o.whyNow && (
        <p className="max-w-2xl border-l-2 border-brass/70 pl-4 text-[14px] leading-snug text-ink-muted">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-brass">Why now · </span>
          {o.whyNow}
        </p>
      )}

      {/* Highest-leverage next action (if present) — one line, not a matrix */}
      {o.headspaceInvestment && (
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[13.5px]">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink-muted">
            Next · {o.headspaceInvestment.estimateHours}
          </span>
          <span className="text-ink">{o.headspaceInvestment.leverage}</span>
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
          className="ml-auto text-ink underline-offset-4 hover:underline"
        >
          Open full brief →
        </Link>
      </div>
    </div>
  );
}