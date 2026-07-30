// src/lib/intelligence/ekb/EKBUnmappedTermDetector.ts

import { EKBCompatibilityAdapter } from "./EKBCompatibilityAdapter";

export interface UnmappedTermDetectionResult {
  indexedTerms: string[];
  unmappedTerms: string[];
  totalTermsEvaluated: number;
}

export class EKBUnmappedTermDetector {

  /**
   * Scans document text and extracts candidate terms that are not yet indexed
   * in the active published EKB graph. Works for ANY industry (Aerospace,
   * CleanTech, Hospitality, Private Equity, FinTech, Biotech, etc.).
   */
  public static detectUnmappedTerms(text: string): UnmappedTermDetectionResult {
    if (!text || text.trim().length === 0) {
      return { indexedTerms: [], unmappedTerms: [], totalTermsEvaluated: 0 };
    }

    // Tokenize noun phrases and candidate technical/executive terms
    const rawTokens = text
      .split(/[\n,;.\•\–\—\-\/\(\)]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && t.length <= 60);

    const indexedTerms: string[] = [];
    const unmappedTerms: string[] = [];

    const seen = new Set<string>();

    for (const token of rawTokens) {
      const lower = token.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);

      const resolved = EKBCompatibilityAdapter.resolveCapability(token);
      if (resolved && resolved.source !== "LEGACY_STATIC_FALLBACK") {
        indexedTerms.push(token);
      } else {
        // If resolved capability is not explicitly known in static ontology, mark as candidate unmapped term
        unmappedTerms.push(token);
      }
    }

    return {
      indexedTerms,
      unmappedTerms,
      totalTermsEvaluated: seen.size,
    };
  }
}
