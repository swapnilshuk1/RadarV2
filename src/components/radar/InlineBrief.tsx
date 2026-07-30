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
    <div className="animate-fade-in pb-1 mt-2">
      
      {/* ────────────────────────────────────────────────────────────────────────
          BLOCK 1: THE CASE (Editorial Heading & Narrative)
          ──────────────────────────────────────────────────────────────────────── */}
      <div className="mb-8 max-w-4xl">
        <h3 className="font-serif text-[20px] sm:text-[22px] text-foreground font-semibold leading-tight mb-3">
          {preview.headline}
        </h3>
        <div className="text-[14.5px] sm:text-[15.5px] leading-[1.6] text-muted-foreground/90 font-normal">
          <MarkdownRenderer content={preview.narrative} isHero={false} />
        </div>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          BLOCK 2: PRIMARY REASONING (Clean, untinted bullet points)
          ──────────────────────────────────────────────────────────────────────── */}
      <div className="mb-8 border-t border-border/40 pt-5 max-w-4xl">
        <h4 className="mono text-[10px] tracking-[0.24em] font-bold uppercase text-muted-foreground mb-5">
          WHY RADAR RECOMMENDS THIS
        </h4>
        
        <ul className="space-y-4 sm:space-y-5">
          <li className="flex items-start gap-3 sm:gap-4 group">
            <span className="text-pursue font-bold mt-0.5 select-none">✓</span>
            <div>
              <span className="mono text-[9px] sm:text-[10px] tracking-wider font-bold block text-foreground uppercase mb-1">
                WHY THIS WORKS
              </span>
              <span className="text-[14px] sm:text-[15px] text-muted-foreground leading-relaxed block">
                {preview.whyItWorks}
              </span>
            </div>
          </li>
          
          <li className="flex items-start gap-3 sm:gap-4 group">
            <span className="text-consider font-bold mt-0.5 select-none">⚠️</span>
            <div>
              <span className="mono text-[9px] sm:text-[10px] tracking-wider font-bold block text-foreground uppercase mb-1">
                WATCH FOR
              </span>
              <span className="text-[14px] sm:text-[15px] text-muted-foreground leading-relaxed block">
                {preview.watchFor}
              </span>
            </div>
          </li>
        </ul>
      </div>

      {/* ────────────────────────────────────────────────────────────────────────
          BLOCK 4: ADVISORY DOSSIER PORTAL
          ──────────────────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-border/50 mt-8">
        <Link
          to="/opportunity/$jobHash"
          params={{ jobHash: o.jobHash }}
          className="mono text-[10px] sm:text-[11.5px] tracking-[0.2em] bg-foreground text-background hover:bg-foreground/90 px-6 py-3 rounded-sm font-bold uppercase transition-all flex items-center gap-2.5 group shrink-0 shadow-md"
          onClick={(e) => e.stopPropagation()}
        >
          <span>OPEN ADVISORY DOSSIER</span>
          <span className="transition-transform group-hover:translate-x-1 font-sans">→</span>
        </Link>

        <a
          href={applyUrlFor(o)}
          target="_blank"
          rel="noopener noreferrer"
          className="mono text-[9.5px] sm:text-[10px] tracking-[0.16em] text-muted-foreground hover:text-foreground font-semibold uppercase transition-colors flex items-center gap-1.5 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          APPLY ON {o.scrapedFrom.toUpperCase()}
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