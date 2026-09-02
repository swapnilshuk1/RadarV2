/**
 * scripts/scraper/run/metrics.ts
 * 
 * First-Class Analytical Metrics Store for Acquisition Economics.
 * Tracks query-level novelty rate, duplicate overlap, and extraction efficiency.
 */

import fs from "fs";
import path from "path";
import { ARTIFACTS_DIR } from "../config";
import type { PortalName, AcquisitionOutcome } from "../types";

export interface QueryRunRecord {
  runId: string;
  portal: PortalName;
  query: string;
  page: number;
  cardsSeen: number;
  cardsParsed: number;
  canonicalDuplicates: number;
  ledgerKnown: number;
  hardFiltered: number;
  identityFailed: number;
  novelAccepted: number;
  novelAcquired: number;
  noveltyRate: number; // 0.0 to 1.0 (novelAccepted / cardsParsed)
  elapsedMs: number;
  timestamp: string;
  outcome?: AcquisitionOutcome;
  hasTransportError?: boolean;
}

export class QueryMetricsStore {
  private static metricsFile = path.join(ARTIFACTS_DIR, "query-metrics.json");
  private static records: QueryRunRecord[] = [];

  static record(metric: QueryRunRecord) {
    this.records.push(metric);
    this.flush();
  }

  static getMetricsForQuery(portal: PortalName, query: string): QueryRunRecord[] {
    this.load();
    return this.records.filter(r => r.portal === portal && r.query === query);
  }

  static getAverageNoveltyRate(portal: PortalName, query: string): number {
    this.load();
    const history = this.getMetricsForQuery(portal, query);
    
    // Invariant: ONLY SUCCESS and SUCCESS_EMPTY may inform novelty / exhaustion.
    // Transport errors, auth errors, bot challenges, timeouts, and extraction failures
    // MUST NEVER penalize query novelty rate or trigger adaptive pruning.
    const validHistory = history.filter(r => {
      if (r.hasTransportError) return false;
      if (r.outcome && r.outcome !== "SUCCESS" && r.outcome !== "SUCCESS_EMPTY") return false;
      return true;
    });

    if (validHistory.length === 0) return 1.0;
    const totalNovel = validHistory.reduce((sum, r) => sum + (r.novelAccepted ?? 0), 0);
    const totalParsed = validHistory.reduce((sum, r) => sum + r.cardsParsed, 0);
    return totalParsed > 0 ? totalNovel / totalParsed : 1.0;
  }

  private static load() {
    if (this.records.length > 0) return;
    try {
      if (fs.existsSync(this.metricsFile)) {
        const raw = fs.readFileSync(this.metricsFile, "utf-8");
        this.records = JSON.parse(raw);
      }
    } catch {
      this.records = [];
    }
  }

  private static flush() {
    try {
      if (!fs.existsSync(ARTIFACTS_DIR)) {
        fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
      }
      fs.writeFileSync(this.metricsFile, JSON.stringify(this.records, null, 2), "utf-8");
    } catch (err: any) {
      console.warn(`[QueryMetricsStore] Failed to write metrics: ${err.message}`);
    }
  }
}
