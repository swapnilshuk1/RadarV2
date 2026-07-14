import type { EvidenceBucket } from "../../data/opportunity-fixtures";

const STYLES: Record<EvidenceBucket, { border: string; text: string; dot: string }> = {
  Matched:      { border: "border-evidence-matched/40",      text: "text-evidence-matched",      dot: "bg-evidence-matched" },
  Adjacent:     { border: "border-evidence-adjacent/40",     text: "text-evidence-adjacent",     dot: "bg-evidence-adjacent" },
  Missing:      { border: "border-hairline",                  text: "text-ink-muted",             dot: "bg-ink-muted/50" },
  Contradicted: { border: "border-evidence-contradicted/50", text: "text-evidence-contradicted", dot: "bg-evidence-contradicted" },
};

export function EvidenceChip({ bucket, label }: { bucket: EvidenceBucket; label: string }) {
  const s = STYLES[bucket];
  return (
    <span className={`inline-flex items-center gap-1.5 border ${s.border} ${s.text} px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.16em]`}>
      <span className={`h-1 w-1 ${s.dot}`} aria-hidden />
      {bucket} · {label}
    </span>
  );
}
