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
