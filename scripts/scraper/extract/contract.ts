// Formal DimensionExtractor contract. The orchestrator (extractor.ts) already
// wires per-dimension extractors via a private SPECS registry; this module
// exposes that contract as a first-class type so tests, the QA harness, and
// future custom pipelines can enumerate extractors uniformly.
import type { DimensionResult, Importance, JobSnapshot } from "../types";

export interface DimensionExtractor {
  key: string;
  label: string;
  importance: Importance;
  extractorId: string;                 // module@version
  extract(snapshot: JobSnapshot): DimensionResult;
}

// Registry filled from the shared SPECS table so both paths stay in sync.
export { getExtractorRegistry } from "./registry";
