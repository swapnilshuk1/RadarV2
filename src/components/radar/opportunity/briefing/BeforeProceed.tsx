interface BeforeProceedProps {
  executionPkg: any;
}

export function BeforeProceed({ executionPkg }: BeforeProceedProps) {
  const primaryQuestion = executionPkg.screeningQuestions[0];
  const secondaryQuestions = executionPkg.screeningQuestions.slice(1);

  return (
    <div className="space-y-2.5">
      <div className="memo-callout border-l-2 border-caution bg-surface-raised p-4 space-y-2">
        <p className="label-mono text-caution font-semibold text-[10px] tracking-wider">Before You Proceed</p>
        <p className="font-display text-lg leading-relaxed text-foreground font-normal">
          {primaryQuestion?.question || "Does this role carry genuine commercial budget authority?"}
        </p>
        <p className="text-xs text-muted-foreground leading-relaxed font-mono">
          <span className="text-primary font-semibold">Why it matters:</span> {primaryQuestion?.whyItMatters || "This single answer is most likely to change today's recommendation."}
        </p>
      </div>

      {secondaryQuestions.length > 0 && (
        <details className="group cursor-pointer mt-1">
          <summary className="text-[11px] text-muted-foreground hover:text-foreground font-mono transition-colors flex items-center justify-between py-1 px-1">
            <span>+ {secondaryQuestions.length} remaining validation questions</span>
            <span className="text-[9px] group-open:rotate-180 transition-transform">▼</span>
          </summary>
          <div className="mt-3.5 space-y-3.5 pl-3.5 border-l border-border/80">
            {secondaryQuestions.map((q: any, idx: number) => (
              <div key={idx} className="space-y-1 text-xs">
                <p className="font-semibold text-foreground">{q.question}</p>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  <span className="text-primary font-medium">Why it matters:</span> {q.whyItMatters}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
