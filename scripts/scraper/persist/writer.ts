import path from "path";
import fs from "fs";
import type { ExtractionResult, DetailedCard } from "../types";
import { EXTRACTION_DIR, SNAPSHOT_DIR, LIVE_SCRAPED_JSON } from "../config";
import { writeJsonAtomic, readJsonSafe, fileAgeHours } from "../utils/fs-atomic";

export interface CanonicalEvaluationEvidenceReference {
  canonicalJobId: string;
  opportunityVersion: string;
  contentHash: string;
  sourcePayloadKey: string | null;
  sourceMediaType: string | null;
}

// Cache paths: keep snapshots and extractions in separate content-addressed
// stores so `live-scraped.json` is never the system of record.
export function snapshotPath(cardHash: string): string {
  return path.join(SNAPSHOT_DIR, `${cardHash}.json`);
}
export function extractionPath(cardHash: string): string {
  return path.join(EXTRACTION_DIR, `${cardHash}.json`);
}

export function readSnapshotIfFresh(cardHash: string, maxAgeHours: number): DetailedCard | null {
  const p = snapshotPath(cardHash);
  if (!fs.existsSync(p)) return null;
  if (fileAgeHours(p) > maxAgeHours) return null;
  return readJsonSafe<DetailedCard>(p);
}

export function writeSnapshot(s: DetailedCard): string {
  const p = snapshotPath(s.cardHash);
  writeJsonAtomic(p, s);
  return p;
}

/**
 * Binds a local acquisition snapshot to the immutable canonical document that
 * downstream projection/evaluation consumes. It does not duplicate document
 * bytes or create a second persistence authority.
 */
export function bindEvaluationEvidence(
  snapshot: DetailedCard,
  reference: CanonicalEvaluationEvidenceReference,
): DetailedCard {
  return {
    ...snapshot,
    evaluationEvidence: {
      state: "BOUND",
      canonicalJobId: reference.canonicalJobId,
      opportunityVersion: reference.opportunityVersion,
      contentHash: reference.contentHash,
      sourcePayloadKey: reference.sourcePayloadKey,
      sourceMediaType: reference.sourceMediaType,
    },
  };
}

export function readExtractionIfFresh(cardHash: string, maxAgeHours: number, extractorVersion: string): ExtractionResult | null {
  const p = extractionPath(cardHash);
  if (!fs.existsSync(p)) return null;
  if (fileAgeHours(p) > maxAgeHours) return null;
  const ex = readJsonSafe<ExtractionResult>(p);
  if (!ex || ex.extractorVersion !== extractorVersion) return null;
  return ex;
}

export function writeExtraction(cardHash: string, ex: ExtractionResult): string {
  const p = extractionPath(cardHash);
  writeJsonAtomic(p, ex);
  return p;
}

// Approved system-of-record — written atomically at the end of a run.
export function writeLiveScraped(records: unknown[]): void {
  writeJsonAtomic(LIVE_SCRAPED_JSON, records);
}

export function collectRecords(): unknown[] {
  const records: unknown[] = [];
  const seenJobHash = new Set<string>();
  
  if (!fs.existsSync(EXTRACTION_DIR)) return records;
  
  const files = fs.readdirSync(EXTRACTION_DIR);
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const ex = fs.readFileSync(path.join(EXTRACTION_DIR, f), "utf-8");
      const parsed = JSON.parse(ex);
      if (seenJobHash.has(parsed.jobHash)) continue;
      seenJobHash.add(parsed.jobHash);
      records.push(parsed);
    } catch (err: any) { 
      console.error(`collectRecords error for ${f}:`, err);
    }
  }
  return records;
}
