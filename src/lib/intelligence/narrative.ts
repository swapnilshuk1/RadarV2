// Layer 4 — Narrative Formatter. The ONLY module that turns a
// RecommendationRecord into English. Framework-agnostic — reusable for
// email, PDF, mobile, or API responses.

import type { OpportunitySource } from "@/data/opportunity-fixtures";
import type { RecommendationRecord } from "./record";
import { playbookNarrative, type EditorialNarrative } from "./editorial";

export type Narrative = EditorialNarrative & Readonly<{
  confidenceLine: string;
  stabilityLine: string;
  comparativeNote: string | null;
  missingEvidenceLine: string | null;
}>;

export function format(
  record: RecommendationRecord,
  source: OpportunitySource,
): Narrative {
  const editorial = playbookNarrative(record, source);

  const recConf = record.confidences?.recommendation || 0;
  const confidenceLine =
    recConf < 0.5
      ? `Confidence is ${pct(recConf)} — several important details are unavailable, but the recommendation stands.`
      : `Confidence ${pct(recConf)}.`;

  const stabilityLine =
    record.stability === "High"
      ? "Stability: high — new evidence is unlikely to change the verb."
      : record.stability === "Medium"
        ? "Stability: medium — one or two missing signals could shift this."
        : "Stability: low — the verb is sensitive to new evidence.";

  const comparativeNote =
    record.comparison.higherThan.length && record.comparison.lowerThan.length
      ? `Ranks above ${record.comparison.higherThan.length} and below ${record.comparison.lowerThan.length} in the current queue.`
      : record.comparison.higherThan.length
        ? `Top of the queue — ranks above ${record.comparison.higherThan.length} others.`
        : record.comparison.lowerThan.length
          ? `Ranks below ${record.comparison.lowerThan.length} other opportunities.`
          : null;

  const missingEvidenceLine = record.explanation.missingEvidence.length
    ? `Missing evidence on: ${record.explanation.missingEvidence.join(", ")}.`
    : null;

  return {
    ...editorial,
    confidenceLine,
    stabilityLine,
    comparativeNote,
    missingEvidenceLine,
  };
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}
