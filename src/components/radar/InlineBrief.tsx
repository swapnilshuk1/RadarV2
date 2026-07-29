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
    <div className="animate-fade-in space-y-3 sm:space-y-4 pt-1 pb-1">
      {/* 1. Concise Recommendation Narrative */}
      <div className="text-[13.5px] sm:text-[15px] leading-relaxed text-foreground font-normal line-clamp-3 sm:line-clamp-none">
        <MarkdownRenderer content={o.recommendation} isHero={false} />
      </div>

      {/* 2. Coordinated Tag Row with Elevated Alignment Badge */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-y border-border/40 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mono text-[9px] sm:text-[10px] tracking-[0.16em] text-primary-foreground bg-foreground px-2 py-0.5 rounded-sm uppercase font-bold">
            {archetype.toUpperCase()} PATH
          </span>
          <span className="mono text-[9px] sm:text-[10px] tracking-[0.16em] text-accent-ink bg-accent-ink/8 px-2 py-0.5 rounded-sm uppercase font-semibold">
            {mandateTag}
          </span>
        </div>
        <span className="mono text-[9.5px] sm:text-[10.5px] tracking-[0.14em] text-pursue bg-pursue/12 px-2.5 py-0.5 rounded-sm font-bold uppercase border border-pursue/20">
          ✓ {alignmentText}
        </span>
      </div>

      {/* 3. Deduplicated Metrics Bar (Certainty & Fatigue) */}
      <div className="grid grid-cols-2 gap-4 border-b border-border/30 pb-2.5">
        <div className="flex items-baseline gap-2">
          <span className="mono text-[9px] sm:text-[10px] tracking-[0.16em] text-muted-foreground uppercase font-semibold shrink-0">
            CERTAINTY
          </span>
          <span className="display text-[20px] sm:text-[24px] leading-none tabular-nums text-pursue font-bold">
            {certaintyPct}<span className="mono text-[10px] text-muted-foreground font-normal">%</span>
          </span>
        </div>

        <div className="flex items-baseline gap-2">
          <span className="mono text-[9px] sm:text-[10px] tracking-[0.16em] text-muted-foreground uppercase font-semibold shrink-0">
            FATIGUE
          </span>
          <span className="display text-[20px] sm:text-[24px] leading-none tabular-nums text-foreground font-bold">
            {tailoringEffort}
          </span>
        </div>
      </div>

      {/* 4. Primary Driver & Primary Risk Inline Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-4">
        <div className="border-l-2 border-pursue/50 pl-2.5 py-0.5 bg-pursue-soft/30 rounded-r-sm">
          <div className="flex items-center gap-1 text-pursue mb-0.5">
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
            <span className="mono text-[8.5px] sm:text-[9.5px] tracking-[0.16em] font-bold">PRIMARY DRIVER</span>
          </div>
          <p className="text-[12.5px] sm:text-[13.5px] text-foreground font-medium leading-snug">{primaryDriver}</p>
        </div>

        <div className="border-l-2 border-consider/50 pl-2.5 py-0.5 bg-consider-soft/30 rounded-r-sm">
          <div className="flex items-center gap-1 text-consider mb-0.5">
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
            <span className="mono text-[8.5px] sm:text-[9.5px] tracking-[0.16em] font-bold">PRIMARY RISK</span>
          </div>
          <p className="text-[12.5px] sm:text-[13.5px] text-foreground font-medium leading-snug">{primaryRisk}</p>
        </div>
      </div>

      {/* 5. Compact Secondary CTAs */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
        <Link
          to="/opportunity/$jobHash"
          params={{ jobHash: o.jobHash }}
          className="mono text-[9.5px] sm:text-[10px] tracking-[0.14em] text-foreground hover:bg-muted/40 px-2.5 py-1.5 rounded-sm font-bold uppercase transition-colors flex items-center gap-1 group shrink-0 border border-border/60"
          onClick={(e) => e.stopPropagation()}
        >
          <span>ADVISORY DOSSIER</span>
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
            className="h-3 w-3 transition-transform group-hover:translate-x-0.5"
          >
            <path d="M5 12h14" />
            <path d="m12 5 7 7-7 7" />
          </svg>
        </Link>

        <a
          href={applyUrlFor(o)}
          target="_blank"
          rel="noopener noreferrer"
          className="mono text-[9.5px] sm:text-[10px] tracking-[0.14em] text-muted-foreground hover:text-foreground px-2.5 py-1.5 rounded-sm font-semibold uppercase transition-colors flex items-center gap-1 shrink-0"
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