// Layer 1 — canonical Opportunity Intelligence schema.
//
// The extractor produces this shape. Every dimension carries provenance:
// its value, whether the JD stated it explicitly / it was inferred / it is
// missing, and the evidence quotes that justify the classification.

import type {
  DimensionKey,
  DimensionResult,
  EvidenceBucket,
  Status,
  Traced,
} from "@/data/opportunity-fixtures";

export type { DimensionKey, DimensionResult, EvidenceBucket, Status, Traced };

export type OpportunityIntelligence = {
  jobHash: string;
  role: string;
  company: string;
  location: string;
  postedRelative: string;
  source: "LinkedIn" | "Naukri" | "Indeed";
  applyUrl?: string;
  dimensions: DimensionResult[];
};

/** Look up a single dimension by key. */
export function dim(
  oi: { dimensions: DimensionResult[] },
  key: DimensionKey,
): DimensionResult | undefined {
  return oi.dimensions.find((d) => d.key === key);
}

/** All ten dimensions the schema anticipates. Additional dimensions can be
 *  added over time; anything missing is treated as unknown, not disqualifying. */
export const CANONICAL_DIMENSIONS: DimensionKey[] = [
  "requiredLevel",
  "reportingLine",
  "mandate",
  "commercialAccountability",
  "functionalScope",
  "geography",
  "workModel",
  "technologyStack",
];