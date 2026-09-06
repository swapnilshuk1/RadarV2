import { useEffect, useRef, useCallback } from "react";
import { Link } from "@tanstack/react-router";
import { Hero } from "../reading/Hero";
import { Context } from "../reading/Context";
import { Mandate } from "../reading/Mandate";
import { Opinion } from "../reading/Opinion";
import { Evidence } from "../reading/Evidence";
import { Strategy } from "../reading/Strategy";
import { Appendix } from "../reading/Appendix";
import { ExecutiveActionButton } from "@/components/radar/actions";
import { Button } from "@/components/ui/button";
import { applicationActionFor, type DecisionVerb } from "@/data/opportunity-fixtures";
import { useSectionPreferences } from "@/lib/section-preferences-store";

import type { DossierDecisionState } from "@/lib/intelligence/decision-state";

interface ReadingSurfaceProps {
  opportunity: any;
  brief: any;
  dossierState: DossierDecisionState;
  decide: (verdict: DecisionVerb) => void;
  neighbors: any;
  currentIndex: number;
  totalCount: number;
  jobProj: any;
  executionPkg: any;
  rawDimensions: any[];
  generatedAt: string;
  focusTopic: string | null;
  whyRoleExists: string | null;
}

/** Scroll-triggered reveal hook: observes children and adds .animate-reveal on viewport entry */
function useScrollReveal() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const sections = container.querySelectorAll<HTMLElement>("[data-reveal]");
    if (!sections.length) return;

    // Hide sections initially
    sections.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translateY(20px)";
      el.style.transition = "none";
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const el = entry.target as HTMLElement;
            el.style.transition = "";
            el.classList.add("animate-reveal");
            observer.unobserve(el);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );

    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  return containerRef;
}

/** Estimate reading time from brief word count */
function estimateReadTime(brief: any): string {
  const countWords = (obj: any): number => {
    if (!obj) return 0;
    if (typeof obj === "string") return obj.split(/\s+/).filter(Boolean).length;
    if (Array.isArray(obj)) return obj.reduce((sum, item) => sum + countWords(item), 0);
    if (typeof obj === "object") return Object.values(obj).reduce((sum: number, val) => sum + countWords(val), 0);
    return 0;
  };
  const words = countWords(brief);
  const minutes = Math.max(1, Math.ceil(words / 220));
  return `${minutes} min read`;
}

export function ReadingSurface({
  opportunity: o,
  brief,
  dossierState,
  decide,
  neighbors,
  currentIndex,
  totalCount,
  jobProj,
  executionPkg,
  rawDimensions,
  generatedAt,
  focusTopic,
  whyRoleExists,
}: ReadingSurfaceProps) {
  const revealRef = useScrollReveal();
  const readTime = estimateReadTime(brief);
  const applicationAction = applicationActionFor(o);

  /* Keyboard shortcuts: P = Pursue, C = Consider, X = Pass, ← = Prev, → = Next */
  const handleKeyboard = useCallback(
    (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key.toUpperCase()) {
        case "P":
          decide("PURSUE");
          break;
        case "C":
          decide("CONSIDER");
          break;
        case "X":
          decide("PASS");
          break;
      }
    },
    [decide]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyboard);
    return () => document.removeEventListener("keydown", handleKeyboard);
  }, [handleKeyboard]);

  const { getSectionState, toggleSection, resetToDefaults } = useSectionPreferences(
    dossierState.selectedActionForControls || "CONSIDER",
    o.archetype
  );

  return (
    <div className="min-h-screen pb-28 bg-background text-foreground font-sans">
      <Hero
        o={o}
        brief={brief}
        dossierState={dossierState}
        currentIndex={currentIndex}
        totalCount={totalCount}
        focusTopic={focusTopic}
        readTime={readTime}
      />

      {/* CORE MEMORANDUM GRID WITH SECTION PREFERENCES */}
      <section className="py-6" ref={revealRef}>
        <div className="memo-container space-y-8">
          {/* Section Toolbar & Layout Preferences */}
          <div className="flex items-center justify-between border-b border-border/50 pb-2">
            <span className="label-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Memorandum Layout · Custom Preferences Active
            </span>
            <button
              onClick={resetToDefaults}
              className="label-mono text-[11px] text-muted-foreground hover:text-foreground underline decoration-dotted underline-offset-4 cursor-pointer transition-colors"
            >
              Reset Layout Defaults
            </button>
          </div>
          {/* Section I: Context */}
          <div data-reveal className="border-t border-border pt-4">
            <div className="flex items-center justify-between cursor-pointer py-2 group select-none" onClick={() => toggleSection("context")}>
              <span className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-semibold">Section I · Why this deserves your attention</span>
              <button className="label-mono text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded bg-surface-raised border border-border cursor-pointer transition-colors">
                {getSectionState("context") === "open" ? "Collapse ▲" : "Expand ▼"}
              </button>
            </div>
            {getSectionState("context") === "open" && <Context brief={brief} whyRoleExists={whyRoleExists} />}
          </div>

          {/* Section II: Mandate */}
          <div data-reveal className="border-t border-border pt-4">
            <div className="flex items-center justify-between cursor-pointer py-2 group select-none" onClick={() => toggleSection("mandate")}>
              <span className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-semibold">Section II · What success requires</span>
              <button className="label-mono text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded bg-surface-raised border border-border cursor-pointer transition-colors">
                {getSectionState("mandate") === "open" ? "Collapse ▲" : "Expand ▼"}
              </button>
            </div>
            {getSectionState("mandate") === "open" && <Mandate brief={brief} jobProj={jobProj} executionPkg={executionPkg} />}
          </div>

          {/* Section III: Evidence */}
          <div data-reveal className="border-t border-border pt-4">
            <div className="flex items-center justify-between cursor-pointer py-2 group select-none" onClick={() => toggleSection("evidence")}>
              <span className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-semibold">Section III · Why this reached your desk</span>
              <button className="label-mono text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded bg-surface-raised border border-border cursor-pointer transition-colors">
                {getSectionState("evidence") === "open" ? "Collapse ▲" : "Expand ▼"}
              </button>
            </div>
            {getSectionState("evidence") === "open" && <Evidence brief={brief} />}
          </div>

          {/* Section IV: Opinion */}
          <div data-reveal className="border-t border-border pt-4">
            <div className="flex items-center justify-between cursor-pointer py-2 group select-none" onClick={() => toggleSection("opinion")}>
              <span className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-semibold">Section IV · Executive Bottom Line</span>
              <button className="label-mono text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded bg-surface-raised border border-border cursor-pointer transition-colors">
                {getSectionState("opinion") === "open" ? "Collapse ▲" : "Expand ▼"}
              </button>
            </div>
            {getSectionState("opinion") === "open" && <Opinion brief={brief} engineVerdict={dossierState.engineVerdict} generatedAt={generatedAt} />}
          </div>

          {/* Section V: Strategy */}
          <div data-reveal className="border-t border-border pt-4">
            <div className="flex items-center justify-between cursor-pointer py-2 group select-none" onClick={() => toggleSection("strategy")}>
              <span className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-semibold">Section V · How to win the conversation</span>
              <button className="label-mono text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded bg-surface-raised border border-border cursor-pointer transition-colors">
                {getSectionState("strategy") === "open" ? "Collapse ▲" : "Expand ▼"}
              </button>
            </div>
            {getSectionState("strategy") === "open" && <Strategy brief={brief} executionPkg={executionPkg} />}
          </div>
        </div>
      </section>

      <Appendix brief={brief} rawDimensions={rawDimensions} />

      {/* FLOATING ACTION DOCK (APPLE/LINEAR STYLE) */}
      <div className="floating-dock justify-between gap-4 pointer-events-auto">
        {/* Left: Previous Brief */}
        <div className="flex items-center gap-1.5 min-w-[70px]">
          {neighbors?.prev ? (
            <Link
              to="/opportunity/$jobHash"
              params={{ jobHash: neighbors.prev }}
              className="dock-link"
            >
              ← PREV
            </Link>
          ) : (
            <span className="dock-link opacity-30 cursor-not-allowed">← PREV</span>
          )}
        </div>

        {/* Center: Verdict Buttons with Keyboard Badges */}
        <div className="flex items-center gap-2">
          <span className="dock-label">Verdict</span>
          
          <button
            onClick={() => decide("PURSUE")}
            className={`dock-btn transition-all shadow-xs ${
              dossierState.selectedActionForControls === "PURSUE"
                ? "bg-emerald-600 text-white"
                : "bg-muted/80 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            Pursue
            <kbd>P</kbd>
          </button>

          <button
            onClick={() => decide("CONSIDER")}
            className={`dock-btn transition-all shadow-xs ${
              dossierState.selectedActionForControls === "CONSIDER"
                ? "bg-amber-600 text-white"
                : "bg-muted/80 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            Consider
            <kbd>C</kbd>
          </button>

          <button
            onClick={() => decide("PASS")}
            className={`dock-btn transition-all shadow-xs ${
              dossierState.selectedActionForControls === "PASS"
                ? "bg-slate-700 text-white"
                : "bg-muted/80 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            Pass
            <kbd>X</kbd>
          </button>
        </div>

        {/* Right: Next Brief + Apply */}
        <div className="flex items-center gap-2 min-w-[70px] justify-end">
          {applicationAction ? (
            <a
              href={applicationAction.url}
              target="_blank"
              rel="noopener noreferrer"
              className="dock-btn bg-emerald-500 text-white hover:bg-emerald-600 transition-colors shadow-xs"
            >
              {applicationAction.label} →
            </a>
          ) : neighbors?.next ? (
            <Link
              to="/opportunity/$jobHash"
              params={{ jobHash: neighbors.next }}
              className="dock-link"
            >
              NEXT →
            </Link>
          ) : (
            <span className="dock-link opacity-30 cursor-not-allowed">NEXT →</span>
          )}
        </div>
      </div>
    </div>
  );
}
