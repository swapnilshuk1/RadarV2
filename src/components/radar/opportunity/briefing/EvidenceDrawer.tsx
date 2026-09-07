interface EvidenceDrawerProps {
  brief: any;
  executionPkg: any;
  whyRoleExists: string | null;
}

export function EvidenceDrawer({
  brief,
  executionPkg,
  whyRoleExists,
}: EvidenceDrawerProps) {
  return (
    <details className="group border border-border/80 rounded bg-surface-raised/20 p-4 space-y-4">
      <summary className="label-mono text-[10px] uppercase tracking-wider text-muted-foreground group-open:text-foreground hover:text-foreground flex items-center justify-between cursor-pointer list-none select-none">
        <span>+ Strategic Context & Evidence Ledger</span>
        <span className="text-primary group-open:rotate-180 transition-transform">▼</span>
      </summary>
      
      <div className="mt-4 pt-4 border-t border-border/40 space-y-6">
        {/* SECTION A: Why Hiring (Context) */}
        {whyRoleExists && <div className="space-y-2">
          <h3 className="font-display text-base font-normal text-foreground leading-tight">
            Why is the company hiring?
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground font-normal">
            {whyRoleExists}
          </p>
        </div>}

        {/* SECTION B: Recommendation Assumptions Checklist */}
        <div className="space-y-2.5">
          <p className="label-mono text-xs uppercase tracking-wider text-caution font-semibold text-[9px]">Recommendation Assumptions</p>
          <ul className="space-y-2 text-xs text-foreground pl-0.5">
            {(executionPkg.recommendationConditions || []).map((cond: string, i: number) => (
              <li key={i} className="flex items-start gap-2 leading-relaxed font-normal">
                <span className="text-signal font-bold">✓</span>
                <span className="text-xs text-muted-foreground">{cond}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* SECTION C: Evidence Ledger */}
        <div className="space-y-4">
          <h3 className="font-display text-base font-normal text-foreground leading-tight">
            Evidence Supporting Recommendation
          </h3>
          <div className="space-y-3">
            <div>
              <p className="label-mono text-signal font-semibold text-[9px] tracking-wider">Why we're confident</p>
              <ul className="mt-1.5 space-y-2 text-xs text-foreground pl-0.5 leading-relaxed">
              {(brief.proofPoints || []).slice(0, 3).map((pt: any, i: number) => {
                  const categoryTitle = pt.category || pt.headline || `Evidence point ${i + 1}`;
                  return (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-signal">•</span>
                      <span className="text-xs text-muted-foreground"><strong>{categoryTitle}:</strong> {pt.detail}</span>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="border-t border-border/40 pt-3">
              <p className="label-mono text-caution font-semibold text-[9px] tracking-wider">Remaining uncertainty</p>
              <ul className="mt-1.5 space-y-1.5 text-xs text-foreground pl-0.5 leading-relaxed">
                {brief.whyNotStronger && <li className="flex items-start gap-1.5">
                  <span className="text-caution">•</span>
                  <span className="text-xs text-muted-foreground">{brief.whyNotStronger}</span>
                </li>}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}
