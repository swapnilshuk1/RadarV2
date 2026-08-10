import type { Opportunity } from "../../data/opportunity-fixtures";

const EFFORT_TREATMENT: Record<"Low" | "Medium" | "High", string> = {
  Low: "text-evidence-matched",
  Medium: "text-brass",
  High: "text-evidence-contradicted",
};

export function HeadspaceMatrix({ items }: { items: Opportunity["headspace"] }) {
  return (
    <div className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_auto] gap-x-6 gap-y-3">
      <div className="col-span-3 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_auto] gap-x-6 border-b border-hairline pb-2 label-mono text-ink-muted">
        <span>Action</span><span>Expected Benefit</span><span>Effort</span>
      </div>
      {items.map((h, i) => (
        <div key={i} className="col-span-3 grid grid-cols-[minmax(0,1.4fr)_minmax(0,1.4fr)_auto] gap-x-6 border-b border-hairline/60 pb-3">
          <p className="font-serif text-lg leading-snug text-ink">{h.action}</p>
          <p className="text-sm leading-snug text-ink-muted">{h.benefit}</p>
          <span className={`label-mono ${EFFORT_TREATMENT[h.effort]}`}>{h.effort}</span>
        </div>
      ))}
    </div>
  );
}
