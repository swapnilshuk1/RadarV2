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
import { applyUrlFor, type DecisionVerb } from "@/data/opportunity-fixtures";

interface ReadingSurfaceProps {
  opportunity: any;
  brief: any;
  currentVerdict: DecisionVerb;
  decide: (verdict: DecisionVerb) => void;
  neighbors: any;
  currentIndex: number;
  totalCount: number;
  jobProj: any;
  executionPkg: any;
  rawDimensions: any[];
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
  currentVerdict,
  decide,
  neighbors,
  currentIndex,
  totalCount,
  jobProj,
  executionPkg,
  rawDimensions,
}: ReadingSurfaceProps) {
  const revealRef = useScrollReveal();
  const readTime = estimateReadTime(brief);

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

  return (
    <div className="min-h-screen pb-28 bg-background text-foreground font-sans">
      <Hero
        o={o}
        brief={brief}
        currentVerdict={currentVerdict}
        currentIndex={currentIndex}
        totalCount={totalCount}
        jobProj={jobProj}
        readTime={readTime}
      />

      {/* CORE MEMORANDUM GRID */}
      <section className="py-10" ref={revealRef}>
        <div className="memo-container space-y-12">
          <div data-reveal>
            <Context o={o} brief={brief} jobProj={jobProj} />
          </div>
          <div data-reveal>
            <Mandate o={o} jobProj={jobProj} executionPkg={executionPkg} />
          </div>
          <div data-reveal>
            <Evidence brief={brief} />
          </div>
          <div data-reveal>
            <Opinion brief={brief} currentVerdict={currentVerdict} />
          </div>
          <div data-reveal>
            <Strategy brief={brief} executionPkg={executionPkg} />
          </div>
        </div>
      </section>

      <Appendix brief={brief} rawDimensions={rawDimensions} />

      {/* FLOATING ACTION DOCK (APPLE/LINEAR STYLE) */}
      <div className="floating-dock shadow-2xl flex items-center justify-between gap-4 pointer-events-auto">
        {/* Left: Previous Brief */}
        <div className="flex items-center gap-1.5 min-w-[70px]">
          {neighbors?.prev ? (
            <Link
              to="/opportunity/$jobHash"
              params={{ jobHash: neighbors.prev }}
              className="label-mono text-muted-foreground hover:text-foreground transition-colors font-medium text-[0.7rem]"
            >
              ← Prev
            </Link>
          ) : (
            <span className="label-mono text-muted-foreground font-normal opacity-30 text-[0.7rem]">← Prev</span>
          )}
        </div>

        {/* Center: Verdict Buttons with Keyboard Badges */}
        <div className="flex items-center gap-2">
          <span className="label-mono text-muted-foreground text-[0.68rem] uppercase font-bold mr-1">Verdict</span>
          
          <button
            onClick={() => decide("PURSUE")}
            className={`label-mono flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
              currentVerdict === "PURSUE"
                ? "bg-emerald-600 text-white shadow-xs"
                : "bg-muted/80 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            Pursue
            <kbd className="text-[0.6rem] opacity-70 bg-black/20 px-1 rounded">P</kbd>
          </button>

          <button
            onClick={() => decide("CONSIDER")}
            className={`label-mono flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
              currentVerdict === "CONSIDER"
                ? "bg-amber-600 text-white shadow-xs"
                : "bg-muted/80 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            Consider
            <kbd className="text-[0.6rem] opacity-70 bg-black/20 px-1 rounded">C</kbd>
          </button>

          <button
            onClick={() => decide("PASS")}
            className={`label-mono flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold transition-all cursor-pointer ${
              currentVerdict === "PASS"
                ? "bg-slate-700 text-white shadow-xs"
                : "bg-muted/80 text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            Pass
            <kbd className="text-[0.6rem] opacity-70 bg-black/20 px-1 rounded">X</kbd>
          </button>
        </div>

        {/* Right: Next Brief + Apply */}
        <div className="flex items-center gap-2 min-w-[70px] justify-end">
          {o.applyUrl ? (
            <a
              href={applyUrlFor(o)}
              target="_blank"
              rel="noopener noreferrer"
              className="label-mono flex items-center gap-1 bg-emerald-500 text-white px-3 py-1.5 rounded-full text-[0.68rem] font-bold uppercase tracking-wider hover:bg-emerald-600 transition-colors shadow-xs"
            >
              Apply →
            </a>
          ) : neighbors?.next ? (
            <Link
              to="/opportunity/$jobHash"
              params={{ jobHash: neighbors.next }}
              className="label-mono text-muted-foreground hover:text-foreground transition-colors font-medium text-[0.7rem]"
            >
              Next →
            </Link>
          ) : (
            <span className="label-mono text-muted-foreground font-normal opacity-30 text-[0.7rem]">Next →</span>
          )}
        </div>
      </div>
    </div>
  );
}

