interface EvidenceProps {
  brief: any;
}

export function Evidence({ brief }: EvidenceProps) {
  return (
    <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Evidence</p>
        <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">Evidence Supporting This Recommendation</h2>
      </div>
      <div className="space-y-5">
        <p className="text-xs text-muted-foreground font-normal">Verified evidence demonstrating executive operation at this level:</p>
        <ul className="space-y-4 border-l-2 border-signal pl-4 pt-1">
          {(brief.proofPoints || []).slice(0, 3).map((pt: any, i: number) => {
            const categoryTitle = i === 0 
              ? "Commercial leadership at enterprise scale" 
              : i === 1 
              ? "Global platform transformation" 
              : "Cross-functional operating governance";
            return (
              <li key={i} className="text-xs text-foreground font-normal space-y-1">
                <span className="font-semibold text-foreground text-sm block font-display">{categoryTitle}</span>
                <p className="text-muted-foreground leading-relaxed">{pt.detail}</p>
              </li>
            );
          })}
        </ul>
        <div className="rounded border border-border/80 bg-background p-3.5 space-y-1 text-xs">
          <span className="label-mono text-[11px] text-caution font-normal uppercase">Potential Concern</span>
          <p className="text-muted-foreground leading-relaxed">{brief.whyNotStronger || "Limited direct evidence of enterprise RevOps ownership in current record; verify during initial screening call."}</p>
        </div>
      </div>
    </div>
  );
}
