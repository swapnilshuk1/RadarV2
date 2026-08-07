interface MandateProps {
  o: any;
  jobProj: any;
  executionPkg: any;
}

export function Mandate({ o, jobProj, executionPkg }: MandateProps) {
  return (
    <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Mandate</p>
        <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">
          Your Executive Mandate
        </h2>
      </div>
      <div className="space-y-6">
        <div>
          <p className="label-mono text-xs uppercase tracking-wider text-primary font-normal">What success looks like</p>
          <p className="mt-1 text-xs text-muted-foreground font-mono">Within 18–24 months leadership will likely expect you to:</p>
          <ul className="mt-2.5 space-y-2 border-l-2 border-border pl-4">
            {(jobProj.executiveMission?.successConditions || [
              `Deliver 24-month revenue & P&L targets under commercial growth mandate`,
              `Establish operational governance and cross-functional leadership alignment at ${o.company}`,
              `Build scalable GTM & customer retention infrastructure`
            ]).map((cond: string, i: number) => (
              <li key={i} className="text-sm text-foreground font-normal">• {cond}</li>
            ))}
          </ul>
        </div>

        <div className="border border-border bg-surface-raised/40 p-5 rounded-md space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="label-mono text-caution font-semibold tracking-wider text-[10px]">Calibrated Recommendation Scoping Boundaries</span>
            <span className="label-mono text-[9px] text-muted-foreground uppercase">Verified Gating Criteria</span>
          </div>
          <p className="text-[11px] text-muted-foreground italic font-serif leading-relaxed">
            This advisory evaluation remains valid subject to the following operating parameters being verified during screening:
          </p>
          <div className="grid gap-4 sm:grid-cols-2 pt-1 border-t border-border/40">
            {executionPkg.recommendationConditions.map((cond: string, i: number) => (
              <div key={i} className="flex items-start gap-2.5 border-l border-border/80 pl-2.5 py-0.5">
                <span className="text-signal text-xs leading-none font-bold">✓</span>
                <div className="space-y-0.5">
                  <p className="text-[9px] font-mono text-muted-foreground leading-none">Condition {String(i + 1).padStart(2, "0")}</p>
                  <p className="text-[12px] text-foreground font-normal leading-normal">{cond}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <p className="label-mono text-xs uppercase tracking-wider text-foreground font-normal">Questions to Validate During Your Screening Call</p>
          {executionPkg.screeningQuestions.map((sq: any, i: number) => (
            <div key={i} className="memo-card p-3.5 space-y-1.5 text-xs">
              <p className="font-semibold text-foreground">{i + 1}. {sq.question}</p>
              <p className="text-muted-foreground leading-relaxed"><span className="text-primary font-medium">Why it matters:</span> {sq.whyItMatters}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
