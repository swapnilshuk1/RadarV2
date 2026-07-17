// Enrichment provider abstraction. Providers must NEVER claim Explicit
// evidence — the extractor pipeline marks all provider output as Inferred.
import type { PortalName } from "../types";

export interface EnrichInput {
  title: string;
  company: string;
  location: string;
  snippet: string;
  detailText: string;
  applyUrl: string;
  portal: PortalName;
  missingKeys: string[];
}

export type EnrichPatch = Record<
  string,
  { value: string | null; rationale?: string }
>;

export interface EnrichmentProvider {
  id: string;              // e.g. "gemini-2.5-flash@1.0.0"
  enrich(input: EnrichInput): Promise<EnrichPatch | null>;
}
