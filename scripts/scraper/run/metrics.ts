/**
 * scripts/scraper/run/metrics.ts
 * 
 * First-Class Analytical Metrics Store for Acquisition Economics.
 * Tracks query-level novelty rate, duplicate overlap, and extraction efficiency.
 */

import fs from "fs";
import path from "path";
import { ARTIFACTS_DIR } from "../config";
import type { PortalName } from "../types";

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
    const history = this.getMetricsForQuery(portal, query);
    if (history.length === 0) return 1.0;
    const totalNovel = history.reduce((sum, r) => sum + (r.novelAccepted ?? 0), 0);
    const totalParsed = history.reduce((sum, r) => sum + r.cardsParsed, 0);
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
