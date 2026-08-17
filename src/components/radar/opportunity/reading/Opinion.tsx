interface OpinionProps {
  brief: any;
  engineVerdict?: string | null;
}

export function Opinion({ brief, engineVerdict }: OpinionProps) {
  if (!brief.structuredSections?.synthesis?.thesis) return null;

  const verdictBg =
    engineVerdict === "PURSUE"
      ? "bg-pursue-soft"
      : engineVerdict === "CONSIDER"
      ? "bg-consider-soft"
      : "bg-surface-raised";

  const today = new Date();
  const verdictDate = `${String(today.getDate()).padStart(2, "0")} ${today.toLocaleString("en-GB", { month: "short" })} ${today.getFullYear()}`;

  return (
    <div className={`memo-opinion-box ${verdictBg}`}>
      <div className="flex items-baseline justify-between gap-4 mb-3">
        <p className="label-mono text-primary font-normal uppercase tracking-wider">Bottom line.</p>
        <span className="label-mono text-muted-foreground font-normal">
          {brief.evidenceQuality} · {verdictDate}
        </span>
      </div>
      <p className="font-serif italic text-2xl leading-relaxed text-foreground font-normal">
        {brief.structuredSections.synthesis.thesis}
      </p>
    </div>
  );
}
