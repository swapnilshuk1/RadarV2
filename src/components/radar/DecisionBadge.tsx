import type { DecisionVerb } from "../../data/opportunity-fixtures";

const STYLES: Record<DecisionVerb, string> = {
  PURSUE: "bg-decision-pursue text-decision-pursue-fg",
  CONSIDER: "bg-decision-consider text-decision-consider-fg",
  PASS: "bg-decision-pass text-decision-pass-fg",
};

export function DecisionBadge({ verb, size = "md" }: { verb: DecisionVerb; size?: "sm" | "md" | "lg" }) {
  const sizing = size === "lg" ? "px-3 py-1 text-[11px]" : size === "sm" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[10.5px]";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-none font-mono font-semibold uppercase tracking-[0.22em] ${sizing} ${STYLES[verb]}`}
    >
      <span className="h-1 w-1 rounded-full bg-current" aria-hidden />
      {verb}
    </span>
  );
}
