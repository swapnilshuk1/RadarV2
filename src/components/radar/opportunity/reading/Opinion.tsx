interface OpinionProps {
  brief: any;
}

export function Opinion({ brief }: OpinionProps) {
  return (
    <div className="memo-opinion-box space-y-3">
      <div className="flex items-center justify-between border-b border-border pb-3">
        <span className="label-mono text-xs uppercase tracking-wider text-primary font-semibold">Executive Opinion</span>
        <span className="label-mono text-xs text-muted-foreground">Synthesized Advisory Lead</span>
      </div>
      <p className="font-display text-xl leading-relaxed text-foreground font-normal">
        {brief.executiveOpinion || "Evaluating executive alignment..."}
      </p>
    </div>
  );
}
