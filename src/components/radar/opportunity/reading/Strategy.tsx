import { StrategyWorkspace } from "../briefing/StrategyWorkspace";

interface StrategyProps {
  brief: any;
  executionPkg: any;
}

export function Strategy({ brief, executionPkg }: StrategyProps) {
  return (
    <div className="grid gap-4 border-t border-border pt-6 lg:grid-cols-[16rem_minmax(0,1fr)] lg:gap-10">
      <div className="lg:sticky lg:top-14 lg:self-start">
        <p className="label-mono text-xs uppercase tracking-wider text-muted-foreground font-normal">IV</p>
        <h2 className="mt-1 font-display text-2xl font-normal text-foreground leading-tight">How to win the conversation</h2>
      </div>
      <div className="space-y-6">
        {brief.pursuitStrategy && (
          <div className="memo-callout border-l-2 border-primary bg-surface-raised p-4 space-y-2">
            <div className="flex items-center justify-between">
              <span className="label-mono text-primary font-semibold text-[10px] tracking-wider uppercase">
                {brief.pursuitStrategy.executiveLabel}
              </span>
              <span className="label-mono text-muted-foreground text-[10px]">
                {brief.pursuitStrategy.pursuitMode.replace(/_/g, " ")}
              </span>
            </div>
            <p className="text-xs text-foreground font-mono leading-relaxed">
              <strong>Next Action:</strong> {brief.pursuitStrategy.immediateNextAction}
            </p>
            {brief.pursuitStrategy.stopCondition && (
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                <strong>Guidance Boundary:</strong> {brief.pursuitStrategy.stopCondition}
              </p>
            )}
          </div>
        )}

        {brief.structuredSections?.strategy?.thesis && (
          <p className="font-medium text-foreground text-sm leading-relaxed">
            {brief.structuredSections.strategy.thesis}
          </p>
        )}

        <div className="pt-2">
          <StrategyWorkspace executionPkg={executionPkg} layout="desktop" />
        </div>
      </div>
    </div>
  );
}
