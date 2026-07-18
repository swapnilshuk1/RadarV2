/**
 * extraction-evidence.ts
 *
 * Platform-wide canonical contract for all data extraction.
 * Spoken by every extractor in the RADAR pipeline (Role, Tech Stack, Reporting Line, etc.).
 *
 * Invariant:
 * All extractors emit only ExtractionEvidence. No extractor may communicate directly
 * with the Capability Engine through a custom interface (RADAR Constitution Invariant 10).
 */

export interface ExtractionEvidence {
  dimension: string;        // e.g., "functionalCategory", "technologyStack"
  value: any;              // e.g., "Marketing Leadership", ["Salesforce", "Marketo"]
  confidence: number;       // Consensus confidence score [0.0 - 1.0]
  provider: string;         // Name of the primary consensus provider (or "Consensus")
  version: string;          // Extractor or prompt version
  timestamp: string;        // Ingestion timestamp
  lifecycle: "ACTIVE" | "SUPERSEDED" | "RETRACTED" | "EXPIRED"; // Governance lifecycle state
  evidence: Array<{
    quote: string;          // Verbatim source snippet
    provenance: string;     // Contextual source tracking
  }>;
  metadata?: {
    providers?: Array<{     // Individual provider confidence scores
      name: string;
      confidence: number;
    }>;
    alternatives?: Array<{  // Alternative classifications for downstream calibration
      category: string;
      confidence: number;
    }>;
    latencyMs?: number;     // Execution performance metric
    [key: string]: any;
  };
}
