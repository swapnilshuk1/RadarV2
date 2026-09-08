interface MandateProps {
  brief: any;
}

export function Mandate({ brief }: MandateProps) {
  return (
    <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
      <div className="lg:sticky lg:top-14 lg:self-start">
        <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">II</p>
        <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">
          What success requires
        </h2>
      </div>
      <div className="space-y-6">
        {brief?.structuredSections?.mandate?.thesis && (
          <p className="font-medium text-foreground text-sm leading-relaxed">
            {brief.structuredSections.mandate.thesis}
          </p>
        )}
        
        {brief?.rankedUnknowns?.length > 0 && <div className="space-y-3 pt-2">
          <p className="text-sm font-medium text-foreground">Critical screening questions</p>
          <div className="space-y-3">
            {brief.rankedUnknowns.map((unknown: any, i: number) => (
              <div key={i} className="space-y-0.5">
                <p className="text-sm text-foreground font-normal">{i + 1}. {unknown.question}</p>
                <p className="text-xs text-muted-foreground leading-relaxed pl-4">
                  <span className="font-medium text-muted-foreground">Context:</span> {unknown.label}
                </p>
              </div>
            ))}
          </div>
        </div>}

        {brief?.structuredSections?.mandate?.transition && (
          <div className="pt-4 border-t border-border">
            <p className="text-xs text-muted-foreground italic font-serif">
              {brief.structuredSections.mandate.transition}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
