// Enrichment provider abstraction. Providers must NEVER claim Explicit
// evidence — the extractor pipeline marks all provider output as Inferred.
import type { PortalName } from "../types";

/**
 * Timing-only enrichment diagnostics. Values must never include source text,
 * candidate profile content, credentials, or provider request bodies.
 */
export type EnrichmentTelemetry = (
  type: string,
  details: Record<string, unknown>,
) => void | Promise<void>;

export interface EnrichInput {
  title: string;
  company: string;
  location: string;
  snippet: string;
  detailText: string;
  applyUrl: string;
  portal: PortalName;
  missingKeys: string[];
  telemetry?: EnrichmentTelemetry;
}

export type EnrichPatch = Record<string, { value: string | null; rationale?: string }>;

export interface EnrichmentProvider {
  id: string; // Model/config identity participates in enrichment cache identity.
  enrich(input: EnrichInput): Promise<EnrichPatch | null>;
}
