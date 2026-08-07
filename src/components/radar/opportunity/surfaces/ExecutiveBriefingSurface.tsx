import { Summary } from "../briefing/Summary";
import { BeforeProceed } from "../briefing/BeforeProceed";
import { EvidenceDrawer } from "../briefing/EvidenceDrawer";
import { StrategyWorkspace } from "../briefing/StrategyWorkspace";
import { ExecutiveActionButton } from "@/components/radar/actions";
import { Button } from "@/components/ui/button";
import { applyUrlFor, type DecisionVerb } from "@/data/opportunity-fixtures";

interface ExecutiveBriefingSurfaceProps {
  opportunity: any;
  brief: any;
  currentVerdict: DecisionVerb;
  decide: (verdict: DecisionVerb) => void;
  neighbors: any;
  currentIndex: number;
  totalCount: number;
  jobProj: any;
  executionPkg: any;
}

export function ExecutiveBriefingSurface({
  opportunity: o,
  brief,
  currentVerdict,
  decide,
  neighbors,
  currentIndex,
  totalCount,
  jobProj,
  executionPkg,
}: ExecutiveBriefingSurfaceProps) {
  return (
    <div className="min-h-screen pb-36 bg-background text-foreground font-sans">
      <Summary
        o={o}
        brief={brief}
        currentVerdict={currentVerdict}
        currentIndex={currentIndex}
        totalCount={totalCount}
      />

      <section className="py-8 space-y-8">
        <div className="mx-auto max-w-[1180px] px-5 space-y-8">
          <BeforeProceed executionPkg={executionPkg} />
          <EvidenceDrawer
            o={o}
            brief={brief}
            jobProj={jobProj}
            executionPkg={executionPkg}
          />

          {/* STRATEGY WORKSPACE ON MOBILE */}
          <div className="space-y-4">
            <h2 className="font-display text-xl font-normal text-foreground leading-tight">
              Present your experience effectively
            </h2>
            <p className="text-xs text-muted-foreground border-l border-caution pl-2.5 leading-relaxed font-normal">
              {brief.directives?.positioning || "Tailor your narrative to emphasize executive scale and operational governance."}
            </p>
            <StrategyWorkspace executionPkg={executionPkg} layout="mobile" />
          </div>

          {/* APPENDIX FOOTER - Keep standard static details in collapsed drawer */}
          <footer className="border-t border-border pt-4 text-[10px] leading-relaxed font-mono text-muted-foreground">
            <details className="group cursor-pointer">
              <summary className="label-mono text-[9px] uppercase tracking-wider text-muted-foreground hover:text-foreground flex items-center justify-between">
                <span>Appendix</span>
                <span className="text-primary group-open:rotate-180 transition-transform">▼</span>
              </summary>
              <div className="mt-4 space-y-4 border-t border-border/40 pt-4">
                <p><strong>Methodology:</strong> Multi-hop evidence graph traversal, dual-vector alignment, and policy scoring.</p>
                <p><strong>Provenance:</strong> {brief.evidenceQuality} · Verified against 5 core capability ontologies.</p>
                <p><strong>Engine:</strong> RADAR v2.4 Editorial Engine · Protocol INV-DATA-SUFFICIENCY active.</p>
              </div>
            </details>
          </footer>
        </div>
      </section>

      {/* STICKY BOTTOM ACTION BAR */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 backdrop-blur-md py-3">
        <div className="mx-auto max-w-[1180px] px-5">
          <div className="flex flex-col gap-3">
            {/* Left Column: Verdict Controls */}
            <div className="flex flex-1 items-center gap-2">
              <span className="label-mono text-muted-foreground font-normal mr-1 text-[10px] tracking-wider uppercase hidden sm:inline">Verdict</span>
              <ExecutiveActionButton
                verdict="PURSUE"
                isActive={currentVerdict === "PURSUE"}
                onClick={() => decide("PURSUE")}
                className="flex-1 text-[10px]"
              >
                Pursue
              </ExecutiveActionButton>

              <ExecutiveActionButton
                verdict="CONSIDER"
                isActive={currentVerdict === "CONSIDER"}
                onClick={() => decide("CONSIDER")}
                className="flex-1 text-[10px]"
              >
                Consider
              </ExecutiveActionButton>

              <ExecutiveActionButton
                verdict="PASS"
                isActive={currentVerdict === "PASS"}
                onClick={() => decide("PASS")}
                className="flex-1 text-[10px]"
              >
                Pass
              </ExecutiveActionButton>
            </div>

            {/* Right Column: Apply button */}
            {o.applyUrl ? (
              <Button
                asChild
                className="w-full flex items-center justify-center gap-2 rounded bg-foreground px-4 py-2.5 font-mono text-xs text-background uppercase tracking-[0.14em] hover:opacity-90 font-normal h-auto"
              >
                <a href={applyUrlFor(o)} target="_blank" rel="noopener noreferrer">
                  Apply direct →
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
