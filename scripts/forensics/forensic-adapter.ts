/**
 * scripts/forensics/forensic-adapter.ts
 *
 * RADAR v2 — Phase B Diagnostic Telemetry Wrapper.
 * Active ONLY when process.env.RADAR_FORENSICS === "1".
 *
 * Captures query durations, sanitized fingerprints, row counts, and concurrency
 * without exposing raw PII or mutating domain logic.
 */

import type { DatabaseAdapter, QueryParams } from "../../src/data/database/adapter";
import { AsyncLocalStorage } from "async_hooks";

export interface QueryTraceRecord {
  queryId: string;
  traceId?: string;
  fingerprint: string;
  durationMs: number;
  rowsReturned: number;
  isConcurrent: boolean;
  targetEngine: string;
  startedAt: number;
  completedAt: number;
}

export const traceStorage = new AsyncLocalStorage<{ traceId: string; spanId: string }>();

class ForensicTraceRegistry {
  private traces: QueryTraceRecord[] = [];
  private activeQueries = 0;
  private queryCounter = 0;

  record(q: QueryTraceRecord) {
    this.traces.push(q);
  }

  getTraces(): QueryTraceRecord[] {
    return [...this.traces];
  }

  clear() {
    this.traces = [];
    this.activeQueries = 0;
    this.queryCounter = 0;
  }

  nextQueryId(): string {
    this.queryCounter++;
    return `sql_${this.queryCounter.toString().padStart(3, "0")}`;
  }

  incrementActive() {
    this.activeQueries++;
  }

  decrementActive() {
    this.activeQueries = Math.max(0, this.activeQueries - 1);
  }

  getActiveCount(): number {
    return this.activeQueries;
  }
}

export const globalForensicTraces = new ForensicTraceRegistry();

export function sanitizeSqlFingerprint(sql: string): string {
  const normalized = sql.replace(/\s+/g, " ").trim().toUpperCase();

  if (normalized.includes("FROM PEOPLE WHERE ID =")) return "people_by_id";
  if (normalized.includes("FROM MEMBERSHIPS WHERE USER_ID =")) return "memberships_by_user";
  if (normalized.includes("FROM SEARCH_PLANS") && normalized.includes("EVALUATION_CONTEXTS")) return "active_search_plan_context";
  if (normalized.includes("FROM SEARCH_PLAN_CANDIDATES") && normalized.includes("CANONICAL_OPPORTUNITIES")) return "canonical_candidate_serving_join";
  if (normalized.includes("FROM CANONICAL_DECISIONS")) return "canonical_decisions_query";
  if (normalized.includes("FROM AUTH_SESSIONS")) return "auth_session_validation";
  if (normalized.includes("FROM CANONICAL_OPPORTUNITIES") && normalized.includes("WHERE CO.SOURCE_JOB_ID =")) return "canonical_opportunity_dossier_get";
  if (normalized.includes("INSERT INTO CANONICAL_DECISIONS") || normalized.includes("INSERT INTO DECISIONS")) return "upsert_decision_action";
  if (normalized.includes("INSERT INTO AUTH_SESSIONS")) return "insert_auth_session";

  // Fallback sanitized first 4 tokens
  const tokens = normalized.split(" ").slice(0, 5).join("_").toLowerCase();
  return tokens || "unknown_sql_query";
}

export class DiagnosticDatabaseAdapter implements DatabaseAdapter {
  constructor(private inner: DatabaseAdapter, private engine: string = "Turso LibSQL Cloud") {}

  async one<T>(sql: string, params: QueryParams = []): Promise<T | null> {
    const queryId = globalForensicTraces.nextQueryId();
    const context = traceStorage.getStore();
    const fingerprint = sanitizeSqlFingerprint(sql);

    globalForensicTraces.incrementActive();
    const isConcurrent = globalForensicTraces.getActiveCount() > 1;
    const start = performance.now();

    try {
      const result = await this.inner.one<T>(sql, params);
      const durationMs = Math.round((performance.now() - start) * 100) / 100;

      globalForensicTraces.record({
        queryId,
        traceId: context?.traceId,
        fingerprint,
        durationMs,
        rowsReturned: result !== null ? 1 : 0,
        isConcurrent,
        targetEngine: this.engine,
        startedAt: start,
        completedAt: performance.now(),
      });

      return result;
    } finally {
      globalForensicTraces.decrementActive();
    }
  }

  async many<T>(sql: string, params: QueryParams = []): Promise<T[]> {
    const queryId = globalForensicTraces.nextQueryId();
    const context = traceStorage.getStore();
    const fingerprint = sanitizeSqlFingerprint(sql);

    globalForensicTraces.incrementActive();
    const isConcurrent = globalForensicTraces.getActiveCount() > 1;
    const start = performance.now();

    try {
      const results = await this.inner.many<T>(sql, params);
      const durationMs = Math.round((performance.now() - start) * 100) / 100;

      globalForensicTraces.record({
        queryId,
        traceId: context?.traceId,
        fingerprint,
        durationMs,
        rowsReturned: results.length,
        isConcurrent,
        targetEngine: this.engine,
        startedAt: start,
        completedAt: performance.now(),
      });

      return results;
    } finally {
      globalForensicTraces.decrementActive();
    }
  }

  async execute(sql: string, params: QueryParams = []): Promise<{ rowsAffected: number; lastInsertRowid?: any }> {
    const queryId = globalForensicTraces.nextQueryId();
    const context = traceStorage.getStore();
    const fingerprint = sanitizeSqlFingerprint(sql);

    globalForensicTraces.incrementActive();
    const isConcurrent = globalForensicTraces.getActiveCount() > 1;
    const start = performance.now();

    try {
      const result = await this.inner.execute(sql, params);
      const durationMs = Math.round((performance.now() - start) * 100) / 100;

      globalForensicTraces.record({
        queryId,
        traceId: context?.traceId,
        fingerprint,
        durationMs,
        rowsReturned: result.rowsAffected,
        isConcurrent,
        targetEngine: this.engine,
        startedAt: start,
        completedAt: performance.now(),
      });

      return result;
    } finally {
      globalForensicTraces.decrementActive();
    }
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    return this.inner.transaction(async (tx) => {
      const diagTx = new DiagnosticDatabaseAdapter(tx, this.engine);
      return fn(diagTx);
    });
  }
}
