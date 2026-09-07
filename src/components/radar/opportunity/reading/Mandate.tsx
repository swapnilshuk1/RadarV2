interface MandateProps {
  brief: any;
  jobProj: any;
  executionPkg: any;
}

export function Mandate({ brief, jobProj, executionPkg }: MandateProps) {
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
        
        {jobProj.executiveMission?.successConditions?.length > 0 && <div>
          <p className="text-sm text-foreground font-normal mb-2.5">Published success conditions:</p>
          <ul className="space-y-2 border-l-2 border-border pl-4">
            {jobProj.executiveMission.successConditions.map((cond: string, i: number) => (
              <li key={i} className="text-sm text-muted-foreground font-normal">• {cond}</li>
            ))}
          </ul>
        </div>}

        <div className="space-y-2 pt-2">
          <p className="text-sm font-medium text-foreground">Operating conditions to verify</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            This advisory evaluation assumes the following parameters. Verify them during your first screening:
          </p>
          <ul className="space-y-1.5 pt-1">
            {(executionPkg.recommendationConditions || []).map((cond: string, i: number) => (
              <li key={i} className="text-xs text-muted-foreground font-normal flex items-start gap-1.5">
                <span className="text-muted-foreground">•</span>
                <span>{cond}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-3 pt-2">
          <p className="text-sm font-medium text-foreground">Critical screening questions</p>
          <div className="space-y-3">
            {(executionPkg.screeningQuestions || []).map((sq: any, i: number) => (
              <div key={i} className="space-y-0.5">
                <p className="text-sm text-foreground font-normal">{i + 1}. {sq.question}</p>
                <p className="text-xs text-muted-foreground leading-relaxed pl-4">
                  <span className="font-medium text-muted-foreground">Context:</span> {sq.whyItMatters}
                </p>
              </div>
            ))}
          </div>
        </div>

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
