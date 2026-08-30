/**
 * src/lib/intelligence/serving/observability.ts
 *
 * RADAR v2 — Phase 9 Request Observability & Serving Telemetry.
 *
 * Lightweight, zero-overhead telemetry for measuring serving stage decomposition:
 * - Scope Resolution
 * - SQL Query Execution (WAN)
 * - Pure In-Memory Transformation
 * - Serialization & Response Sizing
 * - In-Flight Coalescing
 */

export interface ServingTimings {
  readonly scopeMs: number;
  readonly sqlQueryMs: number;
  readonly transformMs: number;
  readonly totalMs: number;
}

export interface ServingTelemetry {
  readonly queryType: "feed" | "metrics" | "dossier" | "navigation";
  readonly tenantId: string;
  readonly personId: string;
  readonly timings: ServingTimings;
  readonly coalesced: boolean;
  readonly payloadBytes?: number;
  readonly itemCount?: number;
}

export type TelemetryListener = (telemetry: ServingTelemetry) => void;

class TelemetryEmitter {
  private listeners: TelemetryListener[] = [];

  subscribe(listener: TelemetryListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  emit(telemetry: ServingTelemetry): void {
    for (const listener of this.listeners) {
      try {
        listener(telemetry);
      } catch (err) {
        console.error("Telemetry listener error:", err);
      }
    }
  }
}

export const servingTelemetry = new TelemetryEmitter();

export class ServingStopwatch {
  private startTime: number;
  private scopeResolvedTime?: number;
  private sqlExecutedTime?: number;
  private completedTime?: number;

  constructor() {
    this.startTime = performance.now();
  }

  markScopeResolved(): void {
    this.scopeResolvedTime = performance.now();
  }

  markSqlExecuted(): void {
    this.sqlExecutedTime = performance.now();
  }

  finish(): ServingTimings {
    this.completedTime = performance.now();
    const scopeEnd = this.scopeResolvedTime ?? this.startTime;
    const sqlEnd = this.sqlExecutedTime ?? scopeEnd;
    const finishEnd = this.completedTime;

    return {
      scopeMs: Math.max(0, scopeEnd - this.startTime),
      sqlQueryMs: Math.max(0, sqlEnd - scopeEnd),
      transformMs: Math.max(0, finishEnd - sqlEnd),
      totalMs: Math.max(0, finishEnd - this.startTime),
    };
  }
}
