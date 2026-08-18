import type { PlatformInterpretationResult } from "@/lib/intelligence/platform/PlatformIntelligenceEngine";

interface PlatformIntelligenceCardProps {
  interpretation?: PlatformInterpretationResult;
  currentVerdict: string;
  qualityScore: number | null;
}

export function PlatformIntelligenceCard({
  interpretation,
  currentVerdict,
  qualityScore,
}: PlatformIntelligenceCardProps) {
  // Adaptive Rendering Invariant: Hide entirely if missing or signal unavailable
  if (!interpretation || interpretation.relationshipState === "MISSING" || interpretation.intelligence.topApplicantBadge.state !== "AVAILABLE") {
    return null;
  }

  const { intelligence, relationshipState, advisoryStatement } = interpretation;
  const isTopApplicant = intelligence.topApplicantBadge.value === true;
  const rankPercentile = intelligence.applicantRankPercentile.value;
  const count = intelligence.applicantCount.value;
  const provenanceMode = intelligence.provenanceMode || "FIXTURE";
  const retrievedAt = intelligence.retrievedAt ? new Date(intelligence.retrievedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : null;

  const provenanceBadgeLabel = 
    provenanceMode === "LIVE_AUTHORIZED" ? "LIVE AUTHORIZED" :
    provenanceMode === "LOCAL_EXPERIMENT" ? "LOCAL EXPERIMENT" : "FIXTURE / MOCK";

  return (
    <div className="memo-card border border-border bg-surface-raised p-5 rounded-md space-y-4">
      {/* Module Header & Provenance */}
      <div className="flex items-center justify-between gap-2 border-b border-border pb-2.5">
        <div className="flex items-center gap-2">
          <span className="label-mono font-bold text-xs uppercase text-primary">
            {intelligence.source} Intelligence
          </span>
          <span className="text-[0.65rem] font-mono px-1.5 py-0.5 rounded bg-surface border border-border text-muted-foreground">
            PROVENANCE: {provenanceBadgeLabel}
          </span>
          {retrievedAt && (
            <span className="text-[0.65rem] font-mono text-muted-foreground hidden sm:inline">
              Retrieved: {retrievedAt}
            </span>
          )}
        </div>
        <span className={`label-mono text-[0.65rem] px-2 py-0.5 rounded font-bold uppercase ${
          relationshipState === "CONVERGENCE"
            ? "bg-signal/20 text-signal border border-signal/30"
            : relationshipState === "CONFLICT"
            ? "bg-caution/20 text-caution border border-caution/30"
            : "bg-surface text-muted-foreground border border-border"
        }`}>
          {relationshipState.replace(/_/g, " ")}
        </span>
      </div>

      {/* Structured Comparison Grid: Platform Signal vs RADAR Interpretation */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
        {/* Left Column: Platform Signal */}
        <div className="space-y-1.5 p-3 rounded border border-border/50 bg-surface/50">
          <span className="label-mono text-[0.65rem] text-muted-foreground uppercase tracking-wider block">
            {intelligence.source.toUpperCase()} PLATFORM SIGNAL
          </span>
          <p className="font-display text-xl font-normal text-foreground">
            {isTopApplicant ? "Top Applicant Badge" : "Standard Applicant Match"}
          </p>
          <p className="text-xs font-mono text-muted-foreground">
            {rankPercentile ? `Top ${100 - rankPercentile}% Candidate Pool` : "Applicant Signal Extracted"}
            {count ? ` · ${count} total applicants` : ""}
          </p>
        </div>

        {/* Right Column: RADAR Interpretation */}
        <div className="space-y-1.5 p-3 rounded border border-border/50 bg-surface/50">
          <span className="label-mono text-[0.65rem] text-muted-foreground uppercase tracking-wider block">
            RADAR INTERPRETATION
          </span>
          <p className="font-display text-xl font-normal text-foreground">
            {currentVerdict} {qualityScore != null ? `(${qualityScore}/100)` : ""}
          </p>
          <p className="text-xs font-mono text-muted-foreground">
            Intrinsic Opportunity Quality Evaluation
          </p>
        </div>
      </div>

      {/* Advisory Relationship Note */}
      <div className="border-t border-border pt-3">
        <p className="text-xs font-mono leading-relaxed text-foreground border-l-2 border-primary pl-3">
          {advisoryStatement}
        </p>
      </div>
    </div>
  );
}
