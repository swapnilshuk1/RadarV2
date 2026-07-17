// Layer 3 — Explanation Engine. Emits STRUCTURED objects only. No prose.
// The Narrative Formatter is the sole prose author.

import { dim, type OpportunityIntelligence } from "./schema";
import type { PriorityResult } from "./priority";

export type ExplanationObject = Readonly<{
  reason: string;             // structured tag: e.g. "career-value-dominant"
  dominantFactor: PriorityResult["dominantFactor"];
  missingEvidence: string[];  // dimension keys with status = Missing
  unknowns: string[];         // dimension keys where JD is silent AND market absent
}>;

export function explain(input: {
  oi: OpportunityIntelligence;
  priority: PriorityResult;
  marketAvailable: boolean;
}): ExplanationObject {
  const missing: string[] = [];
  const unknowns: string[] = [];
  for (const d of input.oi.dimensions) {
    if (d.jdEvidence.status === "Missing") missing.push(d.key);
    if (d.bucket === "Missing" && !input.marketAvailable) unknowns.push(d.key);
  }
  // Also flag Core dimensions with weak evidence.
  for (const key of ["reportingLine", "commercialAccountability"] as const) {
    const d = dim(input.oi, key);
    if (d && d.jdEvidence.status !== "Explicit" && !missing.includes(key)) {
      unknowns.push(key);
    }
  }
  const reason =
    input.priority.dominantFactor === "careerValue"
      ? "career-value-dominant"
      : input.priority.dominantFactor === "shortlistingPotential"
        ? "shortlisting-fit-dominant"
        : "friction-dominant";
  return {
    reason,
    dominantFactor: input.priority.dominantFactor,
    missingEvidence: missing,
    unknowns,
  };
}