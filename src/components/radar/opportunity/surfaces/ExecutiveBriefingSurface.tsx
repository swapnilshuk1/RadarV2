import { Summary } from "../briefing/Summary";
import { BeforeProceed } from "../briefing/BeforeProceed";
import { EvidenceDrawer } from "../briefing/EvidenceDrawer";
import { StrategyWorkspace } from "../briefing/StrategyWorkspace";
import { ExecutiveActionButton } from "@/components/radar/actions";
import { Button } from "@/components/ui/button";
import { applicationActionFor, type DecisionVerb } from "@/data/opportunity-fixtures";
import type { DossierDecisionState } from "@/lib/intelligence/decision-state";

interface ExecutiveBriefingSurfaceProps {
  opportunity: any;
  brief: any;
  dossierState: DossierDecisionState;
  decide: (verdict: DecisionVerb) => void;
  neighbors: any;
  currentIndex: number;
  totalCount: number;
  jobProj: any;
  executionPkg: any;
  whyRoleExists: string | null;
}

export function getBriefProvenanceLabel(brief: {
  evidenceQuality?: string;
  explanation?: { evidenceStrength?: string };
}): string {
  if (brief.explanation?.evidenceStrength === "INSUFFICIENT") {
    return "Insufficient evidence — verification pending.";
  }
  return `${brief.evidenceQuality || "Evidence quality unavailable"} · Claim strength reflects recorded evidence.`;
}

export function ExecutiveBriefingSurface({
  opportunity: o,
  brief,
  dossierState,
  decide,
  neighbors,
  currentIndex,
  totalCount,
  jobProj,
  executionPkg,
  whyRoleExists,
}: ExecutiveBriefingSurfaceProps) {
  const provenanceLabel = getBriefProvenanceLabel(brief);
  const applicationAction = applicationActionFor(o);

  return (
    <div className="min-h-screen pb-36 bg-background text-foreground font-sans">
      <Summary
        o={o}
        brief={brief}
        dossierState={dossierState}
        currentIndex={currentIndex}
        totalCount={totalCount}
      />

      <section className="py-8 space-y-8">
        <div className="mx-auto max-w-[1180px] px-5 space-y-8">
          <BeforeProceed executionPkg={executionPkg} />
          <EvidenceDrawer
            brief={brief}
            executionPkg={executionPkg}
            whyRoleExists={whyRoleExists}
          />

          {/* STRATEGY WORKSPACE ON MOBILE */}
          <div className="space-y-4">
            <h2 className="font-display text-xl font-normal text-foreground leading-tight">
              Present your experience effectively
            </h2>
            <p className="text-xs text-muted-foreground border-l border-caution pl-2.5 leading-relaxed font-normal">
              {brief.directives?.positioning || "Positioning guidance was not materialized for this evaluation."}
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
                <p><strong>Provenance:</strong> {provenanceLabel}</p>
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
                isActive={dossierState.selectedActionForControls === "PURSUE"}
                onClick={() => decide("PURSUE")}
                className="flex-1 text-[10px]"
              >
                Pursue
              </ExecutiveActionButton>

              <ExecutiveActionButton
                verdict="CONSIDER"
                isActive={dossierState.selectedActionForControls === "CONSIDER"}
                onClick={() => decide("CONSIDER")}
                className="flex-1 text-[10px]"
              >
                Consider
              </ExecutiveActionButton>

              <ExecutiveActionButton
                verdict="PASS"
                isActive={dossierState.selectedActionForControls === "PASS"}
                onClick={() => decide("PASS")}
                className="flex-1 text-[10px]"
              >
                Pass
              </ExecutiveActionButton>
            </div>

            {/* Right Column: Apply button */}
            {applicationAction ? (
              <Button
                asChild
                className="w-full flex items-center justify-center gap-2 rounded bg-foreground px-4 py-2.5 font-mono text-xs text-background uppercase tracking-[0.14em] hover:opacity-90 font-normal h-auto"
              >
                <a href={applicationAction.url} target="_blank" rel="noopener noreferrer">
                  {applicationAction.label} →
                </a>
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
