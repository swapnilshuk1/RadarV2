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
