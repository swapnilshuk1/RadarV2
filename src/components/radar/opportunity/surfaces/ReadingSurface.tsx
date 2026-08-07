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
  return (
    <div className="min-h-screen pb-28 bg-background text-foreground font-sans">
      <Hero
        o={o}
        brief={brief}
        currentVerdict={currentVerdict}
        currentIndex={currentIndex}
        totalCount={totalCount}
        jobProj={jobProj}
      />

      {/* CORE MEMORANDUM GRID */}
      <section className="py-10">
        <div className="memo-container space-y-12">
          <Context o={o} brief={brief} jobProj={jobProj} />
          <Mandate o={o} jobProj={jobProj} executionPkg={executionPkg} />
          <Opinion brief={brief} />
          <Evidence brief={brief} />
          <Strategy brief={brief} executionPkg={executionPkg} />
        </div>
      </section>

      <Appendix brief={brief} rawDimensions={rawDimensions} />

      {/* STICKY BOTTOM ACTION BAR */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 backdrop-blur-md py-2.5">
        <div className="mx-auto max-w-[1180px] px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="label-mono text-muted-foreground font-normal mr-2">Verdict</span>
            <ExecutiveActionButton
              verdict="PURSUE"
              isActive={currentVerdict === "PURSUE"}
              onClick={() => decide("PURSUE")}
            >
              Pursue
            </ExecutiveActionButton>

            <ExecutiveActionButton
              verdict="CONSIDER"
              isActive={currentVerdict === "CONSIDER"}
              onClick={() => decide("CONSIDER")}
            >
              Consider
            </ExecutiveActionButton>

            <ExecutiveActionButton
              verdict="PASS"
              isActive={currentVerdict === "PASS"}
              onClick={() => decide("PASS")}
            >
              Pass
            </ExecutiveActionButton>
          </div>

          {o.applyUrl ? (
            <Button
              asChild
              className="flex items-center justify-center gap-2 rounded bg-foreground px-4 py-2.5 font-mono text-xs text-background uppercase tracking-[0.14em] hover:opacity-90 font-normal h-auto"
            >
              <a href={applyUrlFor(o)} target="_blank" rel="noopener noreferrer">
                Apply direct →
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
