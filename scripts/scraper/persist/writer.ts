import path from "path";
import fs from "fs";
import type { ExtractionResult, DetailedCard } from "../types";
import { EXTRACTION_DIR, SNAPSHOT_DIR, LIVE_SCRAPED_JSON } from "../config";
import { writeJsonAtomic, readJsonSafe, fileAgeHours } from "../utils/fs-atomic";

import { EXTRACTOR_VERSION } from "../versions";

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
export function extractionPath(cardHash: string, extractorVersion?: string): string {
  if (extractorVersion) {
    return path.join(EXTRACTION_DIR, `${cardHash}__v${extractorVersion}.json`);
  }
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
  // 1. Check version-addressed path first
  const versionedPath = extractionPath(cardHash, extractorVersion);
  if (fs.existsSync(versionedPath) && fileAgeHours(versionedPath) <= maxAgeHours) {
    const ex = readJsonSafe<ExtractionResult>(versionedPath);
    if (ex && ex.extractorVersion === extractorVersion) {
      return ex;
    }
  }

  // 2. Fall back to legacy unversioned path if valid and matching version
  const legacyPath = extractionPath(cardHash);
  if (fs.existsSync(legacyPath) && fileAgeHours(legacyPath) <= maxAgeHours) {
    const ex = readJsonSafe<ExtractionResult>(legacyPath);
    if (ex && ex.extractorVersion === extractorVersion) {
      return ex;
    }
  }

  return null;
}

export function writeExtraction(cardHash: string, ex: ExtractionResult): string {
  const p = extractionPath(cardHash, ex.extractorVersion);
  writeJsonAtomic(p, ex);
  return p;
}

// Approved system-of-record — written atomically at the end of a run.
export function writeLiveScraped(records: unknown[]): void {
  writeJsonAtomic(LIVE_SCRAPED_JSON, records);
}

export function collectRecords(targetExtractorVersion: string = EXTRACTOR_VERSION): unknown[] {
  if (!fs.existsSync(EXTRACTION_DIR)) return [];
  
  const files = fs.readdirSync(EXTRACTION_DIR).filter(f => f.endsWith(".json"));
  
  interface ExtractionCandidate {
    record: any;
    filename: string;
    opportunityVersion: string;
    versionCreatedAt?: string;
    extractedAt?: string;
    mtimeMs: number;
  }

  const candidateRecords: ExtractionCandidate[] = [];

  for (const f of files) {
    try {
      const fullPath = path.join(EXTRACTION_DIR, f);
      const stat = fs.statSync(fullPath);
      const ex = fs.readFileSync(fullPath, "utf-8");
      const parsed = JSON.parse(ex);
      if (parsed.extractorVersion && parsed.extractorVersion !== targetExtractorVersion) {
        continue;
      }
      if (!parsed.jobHash) continue;
      
      const oppVersion = parsed.opportunityVersion || parsed.opportunity_version || parsed.evaluationEvidence?.opportunityVersion || "";
      const verCreatedAt = parsed.versionCreatedAt || parsed.opportunityCreatedAt || undefined;
      candidateRecords.push({
        record: parsed,
        filename: f,
        opportunityVersion: oppVersion,
        versionCreatedAt: verCreatedAt,
        extractedAt: parsed.extractedAt,
        mtimeMs: stat.mtimeMs,
      });
    } catch (err: any) { 
      console.error(`collectRecords error for ${f}:`, err);
    }
  }

  // Group candidates deterministically by jobHash (listing identity)
  const recordsByJobHash = new Map<string, ExtractionCandidate[]>();
  for (const item of candidateRecords) {
    const list = recordsByJobHash.get(item.record.jobHash) || [];
    list.push(item);
    recordsByJobHash.set(item.record.jobHash, list);
  }

  const finalRecords: unknown[] = [];
  const sortedHashes = Array.from(recordsByJobHash.keys()).sort();

  for (const hash of sortedHashes) {
    const candidates = recordsByJobHash.get(hash)!;
    candidates.sort((a, b) => {
      // 1. Authoritative opportunity version creation time (newest first)
      const aVerTime = a.versionCreatedAt ? new Date(a.versionCreatedAt).getTime() : 0;
      const bVerTime = b.versionCreatedAt ? new Date(b.versionCreatedAt).getTime() : 0;
      if (aVerTime > 0 && bVerTime > 0 && aVerTime !== bVerTime) {
        return bVerTime - aVerTime;
      }
      if (aVerTime > 0 && (!bVerTime || bVerTime === 0)) return -1;
      if ((!aVerTime || aVerTime === 0) && bVerTime > 0) return 1;

      // 2. Bound opportunity version presence over unbound
      if (a.opportunityVersion && !b.opportunityVersion) return -1;
      if (!a.opportunityVersion && b.opportunityVersion) return 1;

      // 3. Version-addressed filename priority (__v... over legacy)
      const aVersioned = a.filename.includes(`__v${targetExtractorVersion}`);
      const bVersioned = b.filename.includes(`__v${targetExtractorVersion}`);
      if (aVersioned && !bVersioned) return -1;
      if (!aVersioned && bVersioned) return 1;

      // 4. Extracted timestamp or filesystem mtime (latest first)
      const aTime = a.extractedAt ? new Date(a.extractedAt).getTime() : a.mtimeMs;
      const bTime = b.extractedAt ? new Date(b.extractedAt).getTime() : b.mtimeMs;
      if (bTime !== aTime) return bTime - aTime;

      // 5. Deterministic filename fallback
      return a.filename.localeCompare(b.filename);
    });

    finalRecords.push(candidates[0].record);
  }

  return finalRecords;
}
