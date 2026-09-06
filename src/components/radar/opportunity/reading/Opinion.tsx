interface OpinionProps {
  brief: any;
  engineVerdict?: string | null;
  generatedAt: string;
}

export function Opinion({ brief, engineVerdict, generatedAt }: OpinionProps) {
  if (!brief.structuredSections?.synthesis?.thesis) return null;

  const verdictBg =
    engineVerdict === "PURSUE"
      ? "bg-pursue-soft"
      : engineVerdict === "CONSIDER"
      ? "bg-consider-soft"
      : "bg-surface-raised";

  const evaluated = new Date(generatedAt);
  const verdictDate = Number.isNaN(evaluated.valueOf()) ? "Recorded evaluation" : evaluated.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

  return (
    <div className={`memo-opinion-box ${verdictBg}`}>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <p className="label-mono text-primary font-normal uppercase tracking-wider">Bottom line.</p>
        <span className="label-mono text-muted-foreground font-normal">
          {brief.evidenceQuality} · {verdictDate}
        </span>
      </div>
      <p className="font-serif italic text-2xl leading-relaxed text-foreground font-normal">
        {brief.pursuitStrategy?.bottomLine || brief.explanation?.bottomLine || brief.structuredSections.synthesis.thesis}
      </p>
    </div>
  );
}
