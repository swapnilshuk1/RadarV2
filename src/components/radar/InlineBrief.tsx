import { Link } from "@tanstack/react-router";
import type { Opportunity } from "../../data/opportunity-fixtures";
import { applyUrlFor } from "../../data/opportunity-fixtures";
import { MarkdownRenderer } from "./MarkdownRenderer";

/**
 * Compact brief rendered inline when a shortlist row expands.
 * Aligned 100% with the Executive Advisory Brief layout.
 */
export function InlineBrief({ opportunity: o }: { opportunity: Opportunity }) {
  const score = o.recommendationResult?.score ?? 80;
  const decisionConfidence = o.recommendationResult?.decisionConfidence;
  const certaintyScore = decisionConfidence?.overall ?? (score >= 60 ? 0.85 : 0.65);
  const certaintyPct = Math.round(certaintyScore * 100);

  const archetype = o.recommendationArchetype || "Natural Fit";
  const mandateTag = o.mandateArchetype || "Performance Marketing";
  const primaryDriver = o.primaryDriver || "Media Portfolio Scale (Client Growth)";
  const primaryRisk = o.primaryRisk || "Minor title regression";
  const tailoringEffort = o.tailoringEffort || "LOW";
  const alignmentText = o.capabilityAlignmentText || "EXCELLENT PERFORMANCE-MARKETING MATCH";

  return (
    <div className="animate-fade-in space-y-4 sm:space-y-6 pt-2 pb-2">
      {/* 1. Narrative Conclusion */}
      <div className="display text-[15px] sm:text-[19px] leading-[1.4] text-foreground font-medium line-clamp-3 sm:line-clamp-none">
        <MarkdownRenderer content={o.recommendation} isHero={true} />
      </div>

      {/* 2. Coordinated Tag Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-y border-border/40 py-2.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mono text-[9px] sm:text-[10px] tracking-[0.18em] text-primary-foreground bg-foreground px-2 py-0.5 rounded-sm uppercase font-bold">
            {archetype.toUpperCase()} PATH
          </span>
          <span className="mono text-[9px] sm:text-[10px] tracking-[0.18em] text-accent-ink bg-accent-ink/8 px-2 py-0.5 rounded-sm uppercase font-semibold">
            {mandateTag}
          </span>
        </div>
        <span className="mono text-[9px] sm:text-[10px] tracking-[0.14em] text-pursue bg-pursue-soft px-2.5 py-0.5 rounded-sm font-semibold uppercase">
          ✓ {alignmentText}
        </span>
      </div>

      {/* 3. Top 3 Core Metrics Bar */}
      <div className="grid grid-cols-3 gap-2 sm:gap-6 pb-1">
        <div>
          <span className="mono text-[9px] sm:text-[10px] tracking-[0.18em] text-muted-foreground uppercase font-semibold block mb-1">
            PRIORITY
          </span>
          <div className="flex items-baseline gap-0.5">
            <span className="display text-[22px] sm:text-[36px] leading-none tabular-nums text-foreground font-bold">
              {score}
            </span>
            <span className="mono text-[10px] text-muted-foreground">/100</span>
          </div>
        </div>

        <div>
          <span className="mono text-[9px] sm:text-[10px] tracking-[0.18em] text-muted-foreground uppercase font-semibold block mb-1">
            CERTAINTY
          </span>
          <div className="flex items-baseline gap-0.5">
            <span className="display text-[22px] sm:text-[36px] leading-none tabular-nums text-pursue font-bold">
              {certaintyPct}
            </span>
            <span className="mono text-[10px] text-muted-foreground">%</span>
          </div>
        </div>

        <div>
          <span className="mono text-[9px] sm:text-[10px] tracking-[0.18em] text-muted-foreground uppercase font-semibold block mb-1">
            FATIGUE
          </span>
          <div className="flex items-baseline gap-0.5">
            <span className="display text-[22px] sm:text-[36px] leading-none tabular-nums text-muted-foreground font-bold">
              {tailoringEffort}
            </span>
          </div>
        </div>
      </div>

      {/* 4. Primary Driver & Primary Risk Inline Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-6 pt-1">
        <div className="border-l-2 border-pursue/40 pl-3 py-0.5">
          <div className="flex items-center gap-1.5 text-pursue mb-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3 w-3 shrink-0"
            >
              <path d="M20 6 9 17l-5-5" />
            </svg>
            <span className="mono text-[9px] sm:text-[10px] tracking-[0.18em] font-bold">PRIMARY DRIVER</span>
          </div>
          <p className="text-[13px] sm:text-[14px] text-foreground font-medium leading-snug">{primaryDriver}</p>
        </div>

        <div className="border-l-2 border-consider/40 pl-3 py-0.5">
          <div className="flex items-center gap-1.5 text-consider mb-1">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-3 w-3 shrink-0"
            >
              <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
            <span className="mono text-[9px] sm:text-[10px] tracking-[0.18em] font-bold">PRIMARY RISK</span>
          </div>
          <p className="text-[13px] sm:text-[14px] text-foreground font-medium leading-snug">{primaryRisk}</p>
        </div>
      </div>

      {/* 5. Refined Actions Bar with Primary CTA Hierarchy */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-3 border-t border-border/60">
        <Link
          to="/opportunity/$jobHash"
          params={{ jobHash: o.jobHash }}
          className="mono text-[10.5px] tracking-[0.18em] bg-foreground text-background px-4 py-2.5 rounded-sm font-bold uppercase hover:opacity-90 transition-opacity flex items-center justify-center gap-2 group shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <span>OPEN FULL ADVISORY DOSSIER</span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </Link>

        <a
          href={applyUrlFor(o)}
          target="_blank"
          rel="noopener noreferrer"
          className="mono text-[10px] tracking-[0.16em] border border-border text-foreground px-3.5 py-2 rounded-sm font-semibold uppercase hover:bg-muted/40 transition-colors flex items-center justify-center gap-1.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          APPLY ON {o.scrapedFrom.toUpperCase()}{" "}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
          >
            <path d="M15 3h6v6" />
            <path d="M10 14 21 3" />
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          </svg>
        </a>
      </div>
    </div>
  );
}