import { type DimensionResult } from "../../data/opportunity-fixtures";
import { cleanDimValue } from "../../lib/intelligence/editorial";
import { EvidenceChip } from "./EvidenceChip";

export function DimensionBreakdown({ dimensions }: { dimensions: DimensionResult[] }) {
  const core = dimensions.filter((d) => d.importance === "Core");
  const supporting = dimensions.filter((d) => d.importance === "Supporting");
  const context = dimensions.filter((d) => d.importance === "Context");
  return (
    <div className="space-y-8">
      <Group label="Core" items={core} />
      <Group label="Supporting" items={supporting} />
      <Group label="Context" items={context} />
    </div>
  );
}

function Group({ label, items }: { label: string; items: DimensionResult[] }) {
  if (!items.length) return null;
  return (
    <section>
      <p className="mb-3 font-mono text-[10.5px] uppercase tracking-[0.24em] text-ink-muted">{label}</p>
      <div className="divide-y divide-hairline border-y border-hairline">
        {items.map((d) => (
          <div key={d.key} className="grid grid-cols-[180px_minmax(0,1fr)] gap-6 py-4">
            <div>
              <p className="font-serif text-[17px] text-ink">{d.label}</p>
              <div className="mt-2"><EvidenceChip bucket={d.bucket} label={cleanDimValue(d.jdEvidence.value) || "no evidence"} /></div>
            </div>
            <div className="space-y-2">
              {d.jdEvidence.evidence[0] ? (
                <blockquote className="border-l-2 border-brass/60 pl-3 font-serif italic text-[15px] leading-snug text-ink">
                  “{d.jdEvidence.evidence[0].quote}”
                  <span className="mt-1 block font-sans not-italic text-[10.5px] uppercase tracking-[0.2em] text-ink-muted">
                    Source · {d.jdEvidence.evidence[0].source}
                  </span>
                </blockquote>
              ) : (
                <p className="font-sans text-[13px] italic text-ink-muted">No verbatim evidence in the job description. RADAR will not infer.</p>
              )}
              {d.candidateProof && (
                <div className="mt-2 border border-hairline bg-card px-3 py-2">
                  <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-brass">From your career</p>
                  <p className="mt-1 text-sm leading-snug text-ink">
                    <span className="font-semibold">{d.candidateProof.headline}.</span>{" "}
                    <span className="text-ink-muted">{d.candidateProof.detail}</span>
                  </p>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
