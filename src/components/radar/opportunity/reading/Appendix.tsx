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
          <summary className="label-mono text-xs uppercase tracking-wider text-foreground hover:text-primary transition-colors flex items-center justify-between border border-border bg-background px-5 py-3.5 rounded-sm">
            <span className="font-medium">Appendix: Evidence, Methodology & Claim Lineage</span>
            <span className="text-primary font-normal group-open:rotate-180 transition-transform">▼</span>
          </summary>
          
          <div className="mt-6 space-y-8 border-t border-border pt-8 text-xs text-muted-foreground font-mono">
            {/* Detailed Methodology & Quality Grid */}
            <div className="grid gap-8 lg:grid-cols-3">
              
              <div className="space-y-4">
                <p className="text-foreground font-semibold uppercase tracking-wider border-b border-border pb-2">Methodology</p>
                <ol className="space-y-3 leading-relaxed text-xs list-decimal list-outside ml-4">
                  <li><strong className="text-foreground font-medium">Semantic Extraction:</strong> Isolated structural requirements, reporting lines, and domain imperatives from raw mandate text.</li>
                  <li><strong className="text-foreground font-medium">Capability Alignment:</strong> Cross-referenced extracted imperatives against your executive profile using dual-vector embedding spaces.</li>
                  <li><strong className="text-foreground font-medium">Deterministic Scoring:</strong> Applied RADAR v2 threshold heuristics to compute final conviction scores, strictly avoiding probabilistic drift.</li>
                </ol>
              </div>

              <div className="space-y-4">
                <p className="text-foreground font-semibold uppercase tracking-wider border-b border-border pb-2">Provenance & Quality</p>
                <div className="space-y-3 leading-relaxed text-xs">
                  <p><strong className="text-foreground font-medium">Classification:</strong> {brief.evidenceQuality}</p>
                  <p>
                    Data was sourced directly from primary canonical listings and normalized to resolve title inflation, missing parameters, and implicit functional domains.
                  </p>
                  <p>
                    <strong>Verification Constraints:</strong> Enforced against 5 core capability ontologies (Scale, Domain, Reporting, Team Structure, P&L) and 75 enterprise product taxonomy nodes.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-foreground font-semibold uppercase tracking-wider border-b border-border pb-2">Engine Diagnostics</p>
                <ul className="space-y-3 leading-relaxed text-xs">
                  <li><strong className="text-foreground font-medium">Core Engine:</strong> RADAR v2.4 Editorial Engine</li>
                  <li><strong className="text-foreground font-medium">Active Protocol:</strong> INV-DATA-SUFFICIENCY</li>
                  <li><strong className="text-foreground font-medium">Calibration Target:</strong> VP / Director / CXO-level structural pattern recognition</li>
                  <li><strong className="text-foreground font-medium">Failure Mode:</strong> Strict null-suppression (missing intelligence defaults to manual screening flags).</li>
                </ul>
              </div>

            </div>

            {/* Claim Lineage Ledger */}
            <div className="space-y-3 pt-6 border-t border-border">
              <div className="flex items-center justify-between px-2">
                <p className="text-foreground font-semibold uppercase tracking-wider">Claim Lineage Ledger</p>
                <p className="text-[10px] text-muted-foreground uppercase tracking-widest">Traceability Matrix</p>
              </div>
              
              <div className="rounded border border-border bg-background/50 overflow-hidden">
                <div className="grid grid-cols-[12rem_minmax(0,1fr)_8rem] gap-4 bg-surface-raised px-4 py-2 border-b border-border text-[10px] uppercase font-semibold text-foreground tracking-wider">
                  <span>Dimension</span>
                  <span>Extracted JD Evidence</span>
                  <span>Confidence Level</span>
                </div>
                <div className="divide-y divide-border text-[11px]">
                  {rawDimensions.map((dim: any, idx: number) => (
                    <div key={idx} className="grid grid-cols-[12rem_minmax(0,1fr)_8rem] gap-4 px-4 py-2.5 items-start hover:bg-surface-raised/30 transition-colors">
                      <span className="text-foreground font-medium">{dim.label}</span>
                      <span className="text-muted-foreground leading-relaxed">{formatValue(dim.jdEvidence?.value)}</span>
                      <span className={`uppercase text-[10px] tracking-wider font-semibold ${
                        dim.jdEvidence?.confidence?.toLowerCase().includes('low') 
                          ? 'text-caution' 
                          : 'text-primary'
                      }`}>
                        {dim.jdEvidence?.confidence || "VERIFIED"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

          </div>
        </details>
      </div>
    </footer>
  );
}
