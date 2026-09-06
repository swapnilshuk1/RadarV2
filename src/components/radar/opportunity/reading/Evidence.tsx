interface EvidenceProps {
  brief: any;
}

export function Evidence({ brief }: EvidenceProps) {
  return (
    <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
      <div className="lg:sticky lg:top-14 lg:self-start">
        <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">III</p>
        <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">Why this reached your desk</h2>
      </div>
      <div className="space-y-5">
        {brief.structuredSections?.evidence?.thesis && (
          <p className="font-medium text-foreground text-sm leading-relaxed">
            {brief.structuredSections.evidence.thesis}
          </p>
        )}
        <ul className="space-y-4 border-l-2 border-signal pl-4 pt-1">
          {(brief.proofPoints || []).slice(0, 3).map((pt: any, i: number) => {
            const categoryTitle = pt.category || pt.dimension || `Evidence point ${i + 1}`;
            return (
              <li key={i} className="text-xs text-foreground font-normal space-y-1">
                <span className="font-semibold text-foreground text-sm block font-display">{categoryTitle}</span>
                <p className="text-muted-foreground leading-relaxed">{pt.detail}</p>
              </li>
            );
          })}
        </ul>
        <div className="pt-2">
          <p className="text-muted-foreground text-xs leading-relaxed italic">
            <span className="font-medium text-foreground/80 not-italic mr-1">Note:</span>
            {brief.whyNotStronger || "No additional limitation was materialized for this evaluation."}
          </p>
        </div>
        
        {brief.structuredSections?.evidence?.transition && (
          <div className="pt-4 border-t border-border/40">
            <p className="text-xs text-muted-foreground/80 italic font-serif">
              {brief.structuredSections.evidence.transition}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
