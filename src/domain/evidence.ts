/**
 * evidence.ts
 *
 * Defines the immutable structures for extracting factual evidence from unstructured documents.
 * ADR-011: Evidence is Immutable. EvidenceGraphs are never updated in place.
 */

export type FactType = "EMPLOYMENT" | "ACHIEVEMENT" | "TECHNOLOGY" | "LEADERSHIP" | "EDUCATION" | "LOCATION" | "OTHER";

/**
 * A discrete factual claim extracted directly from a source document.
 * These are NOT mapped to the internal ontology; they represent raw extracted truth.
 */
export interface ExtractedFact {
  /** Unique identifier for this fact instance */
  id: string;
  /** Categorical type of the extracted fact */
  type: FactType;
  /** The normalized value extracted (e.g., "Led SFMC migration") */
  value: string;
  /** LLM certainty score (0.0 to 1.0) */
  confidence: number;
  /** The specific text or structural location where this fact was found */
  sourceSpan: string;
  /** LLM justification for why this fact was extracted */
  justification: string;
}

/**
 * Metadata capturing the exact lineage of this extraction.
 */
export interface ExtractionProvenance {
  /** ID of the source document in the database */
  documentId: string;
  /** Cryptographic hash of the document content at extraction time */
  documentHash: string;
  /** Version of the extraction service/code used */
  extractorVersion: string;
  /** Version/ID of the LLM prompt used */
  promptVersion: string;
  /** The exact LLM model used (e.g., "gpt-4o-2024-05-13") */
  model: string;
  /** ISO 8601 timestamp of extraction */
  createdAt: string;
}

/**
 * An immutable graph of all facts extracted from a single document during a specific pipeline run.
 */
export interface EvidenceGraph {
  /** Unique ID for this specific extraction run */
  id: string;
  /** The user this evidence belongs to */
  personId: string;
  /** The extracted facts */
  facts: ExtractedFact[];
  /** Lineage and audit metadata */
  provenance: ExtractionProvenance;
}

// ============================================================================
// P0-A: Evidence Grounding & Provenance Invariant
// ============================================================================

/**
 * Three-state evidence grounding classification.
 * 
 * - SOURCE_GROUNDED: quote exists verbatim in rawText
 * - STRUCTURED_TRUSTED: evidence from explicitly trusted structured source
 * - UNGROUNDED: neither condition is true
 */
export type EvidenceGroundingState = "SOURCE_GROUNDED" | "STRUCTURED_TRUSTED" | "UNGROUNDED";

/**
 * Provenance sources that are considered explicitly trusted for STRUCTURED_TRUSTED.
 * Absence of provenance does NOT imply trust - must be in this list.
 */
export const STRUCTURED_TRUSTED_PROVENANCE = [
  "curated",
  "extractor", 
  "gold",
  "fixture",
  "onboarder"
] as const;

export type StructuredTrustedProvenance = typeof STRUCTURED_TRUSTED_PROVENANCE[number];

/**
 * Classifies evidence grounding state based on quote presence in rawText and provenance.
 * 
 * Contract:
 * - If quote exists verbatim in rawText → SOURCE_GROUNDED
 * - Else if provenance is in STRUCTURED_TRUSTED_PROVENANCE → STRUCTURED_TRUSTED
 * - Else → UNGROUNDED
 * 
 * @param quote - The evidence quote to check
 * @param rawText - The raw source text to check against
 * @param provenance - The provenance of the evidence (optional)
 * @returns EvidenceGroundingState
 */
export function classifyEvidenceGrounding(
  quote: string,
  rawText: string,
  provenance?: string | null
): EvidenceGroundingState {
  // Check SOURCE_GROUNDED: quote exists verbatim in rawText
  if (quote && rawText) {
    const quoteNormalized = quote.toLowerCase().trim();
    const rawTextNormalized = rawText.toLowerCase();
    if (rawTextNormalized.includes(quoteNormalized)) {
      return "SOURCE_GROUNDED";
    }
  }
  
  // Check STRUCTURED_TRUSTED: provenance is explicitly trusted
  if (provenance && STRUCTURED_TRUSTED_PROVENANCE.includes(provenance as StructuredTrustedProvenance)) {
    return "STRUCTURED_TRUSTED";
  }
  
  // Neither condition met → UNGROUNDED
  return "UNGROUNDED";
}

/**
 * Computes evidence grounding map for all dimensions in an opportunity.
 * 
 * @param dimensions - Array of dimension objects with jdEvidence
 * @param rawText - The raw source text
 * @returns Record mapping dimension keys to their EvidenceGroundingState
 */
export function computeEvidenceGroundingMap(
  dimensions: Array<{ key: string; jdEvidence?: { evidence?: Array<{ quote?: string; provenance?: string }> } }>,
  rawText: string
): Record<string, EvidenceGroundingState> {
  const groundingMap: Record<string, EvidenceGroundingState> = {};
  
  if (!Array.isArray(dimensions)) {
    return groundingMap;
  }
  
  for (const dim of dimensions) {
    const key = dim.key;
    if (!key) continue;
    
    const evidenceList = dim.jdEvidence?.evidence;
    if (!Array.isArray(evidenceList) || evidenceList.length === 0) {
      groundingMap[key] = "UNGROUNDED";
      continue;
    }
    
    // Take the first evidence item's grounding as the dimension's grounding
    // If any evidence is grounded, the dimension is considered grounded
    let bestGrounding: EvidenceGroundingState = "UNGROUNDED";
    
    for (const ev of evidenceList) {
      const quote = ev?.quote || "";
      const provenance = ev?.provenance;
      const grounding = classifyEvidenceGrounding(quote, rawText, provenance);
      
      // SOURCE_GROUNDED is best, then STRUCTURED_TRUSTED
      if (grounding === "SOURCE_GROUNDED") {
        bestGrounding = "SOURCE_GROUNDED";
        break;
      } else if (grounding === "STRUCTURED_TRUSTED" && bestGrounding === "UNGROUNDED") {
        bestGrounding = "STRUCTURED_TRUSTED";
      }
    }
    
    groundingMap[key] = bestGrounding;
  }
  
  return groundingMap;
}
