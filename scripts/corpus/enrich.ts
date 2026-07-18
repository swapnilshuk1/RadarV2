import { extract } from "../scraper/extract/extractor";
import type { DetailedCard, ExtractionResult } from "../scraper/types";
import type { NormalizedOpportunity } from "./normalize";

const CURRENT_DIMENSION_VERSION = "4.1.0";

export interface EnrichedOpportunity extends ExtractionResult {
  dimensionVersion: string;
}

/**
 * Enrich Stage: Evaluates the 8 core dimensions deterministically (and with smart LLM fallback where applicable).
 * IDEMPOTENT: This runs the extraction engine over the normalized/original data.
 */
export async function enrichOpportunity(
  normalized: NormalizedOpportunity,
  original: DetailedCard
): Promise<EnrichedOpportunity> {
  // Leverage the robust deterministic-first extraction suite
  const extractionResult = await extract(original, { mode: "smart" });

  // Re-ensure text content matches the normalized text
  extractionResult.normalizedText = normalized.normalizedText;

  // Clean any malformed Quotes in evidence (e.g. "," or empty/null quotes)
  for (const dim of extractionResult.dimensions) {
    const evidence = dim.jdEvidence.evidence || [];
    dim.jdEvidence.evidence = evidence.filter(ev => {
      if (!ev.quote) return false;
      const q = ev.quote.trim();
      return q !== "" && q !== "," && q !== '""' && q !== '"';
    });
  }

  return {
    ...extractionResult,
    dimensionVersion: CURRENT_DIMENSION_VERSION,
  };
}

export async function enrichCorpus(
  normalized: NormalizedOpportunity[],
  originals: DetailedCard[]
): Promise<EnrichedOpportunity[]> {
  console.log(`[Enrich] Enriching ${normalized.length} opportunities with dimensions...`);
  const enriched: EnrichedOpportunity[] = [];
  
  // Build lookup index of original snapshots by hash
  const originalMap = new Map<string, DetailedCard>();
  for (const orig of originals) {
    originalMap.set(orig.cardHash, orig);
  }

  let count = 0;
  for (const norm of normalized) {
    const orig = originalMap.get(norm.jobHash);
    if (!orig) {
      console.warn(`[Enrich] Could not find original snapshot for jobHash: ${norm.jobHash}`);
      continue;
    }
    
    try {
      const result = await enrichOpportunity(norm, orig);
      enriched.push(result);
      count++;
      if (count % 100 === 0) {
        console.log(`[Enrich] Enriched ${count}/${normalized.length} jobs.`);
      }
    } catch (err: any) {
      console.error(`[Enrich] Failed to enrich job ${norm.jobHash} (${norm.role}):`, err.message);
    }
  }

  console.log(`[Enrich] Successfully enriched ${enriched.length} opportunities.`);
  return enriched;
}
