// Coverage-gated enrichment policy. Decides which dimensions (if any)
// get sent to the enrichment provider after the deterministic pass.
import type { DimensionResult } from "../types";

export type EnrichmentMode = "deterministic" | "smart" | "maximum";

export function pickMissingForEnrichment(
  dims: DimensionResult[],
  mode: EnrichmentMode,
): DimensionResult[] {
  if (mode === "deterministic") return [];
  const isMissing = (d: DimensionResult) => d.jdEvidence.status === "Missing";
  if (mode === "smart") {
    return dims.filter((d) => d.importance === "Core" && isMissing(d));
  }
  // maximum
  return dims.filter(
    (d) => (d.importance === "Core" || d.importance === "Supporting") && isMissing(d),
  );
}

export function resolveMode(): EnrichmentMode {
  const raw = (process.env.ENRICHMENT_MODE || "smart").toLowerCase();
  if (raw === "deterministic" || raw === "smart" || raw === "maximum") return raw;
  return "smart";
}
