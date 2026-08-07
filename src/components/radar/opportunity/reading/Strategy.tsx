import { StrategyWorkspace } from "../briefing/StrategyWorkspace";

interface StrategyProps {
  brief: any;
  executionPkg: any;
}

export function Strategy({ brief, executionPkg }: StrategyProps) {
  return (
    <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
      <div>
        <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">Strategy</p>
        <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">Present your experience effectively</h2>
      </div>
      <div className="space-y-6">
        <div className="space-y-2 border-l-2 border-caution pl-4">
          <p className="label-mono text-xs uppercase tracking-wider text-caution font-normal">Positioning Advisory</p>
          <p className="text-sm leading-relaxed text-foreground font-normal">
            {brief.directives?.positioning || "Tailor your narrative to emphasize executive scale and operational governance."}
          </p>
        </div>

        <div className="memo-card space-y-4">
          <StrategyWorkspace executionPkg={executionPkg} layout="desktop" />
        </div>
      </div>
    </div>
  );
}
