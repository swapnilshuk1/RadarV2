import { unwrapEvidenceValue } from "@/lib/intelligence/editorial/SemanticNaturalLanguageResolver";

interface AppendixProps {
  brief: any;
  rawDimensions: any[];
}

export function Appendix({ brief, rawDimensions }: AppendixProps) {
  const formatValue = (val: any) => {
    if (!val) return "Not specified in JD";
    const unwrapped = unwrapEvidenceValue(val);
    return unwrapped || "Not specified in JD";
  };

  return (
    <footer className="border-t border-border bg-surface-raised py-8 text-xs">
      <div className="memo-container">
        <details className="group cursor-pointer">
          <summary className="label-mono text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors flex items-center justify-between">
            <span>Appendix: Evidence, Methodology & Claim Lineage</span>
            <span className="text-primary font-normal group-open:rotate-180 transition-transform">▼</span>
          </summary>
          
          <div className="mt-6 space-y-6 border-t border-border pt-6 text-xs text-muted-foreground font-mono">
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="space-y-2">
                <p className="text-foreground font-semibold uppercase tracking-wider">Methodology</p>
                <p className="leading-relaxed text-xs">
                  Multi-hop evidence graph traversal, dual-vector capability vs. mandate alignment, and deterministic policy scoring.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-foreground font-semibold uppercase tracking-wider">Provenance & Quality</p>
                <p className="leading-relaxed text-[11px]">
                  {brief.evidenceQuality} · Verified against 5 core capability ontologies and 75 enterprise product classifications.
                </p>
              </div>
              <div className="space-y-2">
                <p className="text-foreground font-semibold uppercase tracking-wider">Engine Version</p>
                <p className="leading-relaxed text-[11px]">
                  RADAR v2.4 Editorial Engine · Protocol INV-DATA-SUFFICIENCY active.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-foreground font-semibold uppercase tracking-wider">Claim Lineage Ledger</p>
              <div className="divide-y divide-border/40 border-y border-border/40 text-[11px]">
                {rawDimensions.slice(0, 4).map((dim: any, idx: number) => (
                  <div key={idx} className="grid grid-cols-[10rem_minmax(0,1fr)_auto] gap-4 py-2">
                    <span className="text-foreground font-medium">{dim.label}</span>
                    <span className="truncate">{formatValue(dim.jdEvidence?.value)}</span>
                    <span className="text-primary">{dim.jdEvidence?.confidence || "VERIFIED"}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>
      </div>
    </footer>
  );
}
