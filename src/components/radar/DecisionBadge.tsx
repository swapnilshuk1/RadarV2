import type { DecisionVerb } from "../../data/opportunity-fixtures";

const STYLES: Record<DecisionVerb, string> = {
  PURSUE: "bg-decision-pursue text-white",
  CONSIDER: "bg-decision-consider text-white",
  PASS: "bg-decision-pass text-white",
  NOT_EVALUABLE: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400",
  SPARSE_SPEC: "bg-amber-500/20 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400 border border-amber-500/30",
};

export function DecisionBadge({ verb, size = "md" }: { verb: DecisionVerb; size?: "sm" | "md" | "lg" }) {
  const sizing = size === "lg" ? "px-3 py-1.5 text-xs" : size === "sm" ? "px-1.5 py-0.5 text-[0.65rem]" : "px-2 py-1 text-[0.65rem]";
  const label = verb === "SPARSE_SPEC" ? "NEEDS MORE SIGNAL" : verb;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-none font-mono font-semibold uppercase tracking-wider ${sizing} ${STYLES[verb]}`}
    >
      <span className="h-1 w-1 rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}
