/**
 * scripts/scraper/run/health-manager.ts
 * 
 * Multi-Layer Capability Health Matrix & FastPath Circuit Breaker.
 * Per-run matrix maps prevent cross-run health contamination.
 */

import { getRepositories } from "../../../src/data/sqlite/provider";

export type CapabilityState = "HEALTHY" | "DEGRADED" | "DISABLED";
export type SessionState = "READY" | "GATED" | "PAUSED";
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface PortalCapabilityMatrix {
  portal: string;
  discovery: CapabilityState;
  detailFastPath: CapabilityState;
  fastPathCircuit: CircuitState;
  detailBrowser: CapabilityState;
  session: SessionState;
  fastPathFailures: number;
  fastPathHistory: boolean[]; // true = success, false = failure (max 10)
  browserFailures: number;
  fastPathCooldownUntil?: number;
  pauseReason?: string;
}

export class RunHealthManager {
  private readonly matrices = new Map<string, PortalCapabilityMatrix>();

  constructor(public readonly runId: string) {}

  getMatrix(portal: string): PortalCapabilityMatrix {
    let matrix = this.matrices.get(portal);

    if (!matrix) {
      matrix = {
        portal,
        discovery: "HEALTHY",
        detailFastPath: "HEALTHY",
        fastPathCircuit: "CLOSED",
        detailBrowser: "HEALTHY",
        session: "READY",
        fastPathFailures: 0,
        fastPathHistory: [],
        browserFailures: 0,
      };
      this.matrices.set(portal, matrix);
    }

    return matrix;
  }

  isFastPathAvailable(portal: string): boolean {
    const matrix = this.getMatrix(portal);

    if (matrix.fastPathCircuit === "OPEN") {
      if (
        matrix.fastPathCooldownUntil &&
        Date.now() > matrix.fastPathCooldownUntil
      ) {
        matrix.fastPathCircuit = "HALF_OPEN";
        matrix.detailFastPath = "DEGRADED";
        return true;
      }
      return false;
    }

    return true;
  }

  recordFastPathSuccess(portal: string): void {
    const matrix = this.getMatrix(portal);

    matrix.fastPathFailures = 0;
    matrix.fastPathHistory.push(true);

    if (matrix.fastPathHistory.length > 10) {
      matrix.fastPathHistory.shift();
    }

    matrix.fastPathCircuit = "CLOSED";
    matrix.detailFastPath = "HEALTHY";
    matrix.fastPathCooldownUntil = undefined;
  }

  recordFastPathFailure(
    portal: string,
    reason: string | number,
  ): void {
    const matrix = this.getMatrix(portal);

    matrix.fastPathFailures++;
    matrix.fastPathHistory.push(false);

    if (matrix.fastPathHistory.length > 10) {
      matrix.fastPathHistory.shift();
    }

    const failures =
      matrix.fastPathHistory.filter((v) => !v).length;

    const failureRate =
      failures / Math.max(1, matrix.fastPathHistory.length);

    const reasonStr = String(reason ?? "");

    if (
      reasonStr.includes("403") ||
      matrix.fastPathFailures >= 5 ||
      (
        matrix.fastPathHistory.length >= 5 &&
        failureRate >= 0.7
      )
    ) {
      matrix.fastPathCircuit = "OPEN";
      matrix.detailFastPath = "DISABLED";
      matrix.fastPathCooldownUntil =
        Date.now() + 5 * 60 * 1000;
      return;
    }

    matrix.detailFastPath = "DEGRADED";
  }

  recordBrowserSuccess(portal: string): void {
    const matrix = this.getMatrix(portal);
    matrix.browserFailures = 0;
    matrix.detailBrowser = "HEALTHY";
  }

  recordBrowserFailure(
    portal: string,
    reason: string,
  ): {
    action:
      | "REPLACE_PAGE"
      | "RESET_CONTEXT"
      | "PAUSE_SESSION";
  } {
    const matrix = this.getMatrix(portal);

    matrix.browserFailures++;

    if (
      reason.includes("BOT_CHALLENGE") ||
      reason.includes("LOGIN_REQUIRED") ||
      matrix.browserFailures >= 6
    ) {
      matrix.session = "GATED";
      matrix.pauseReason = reason;
      return { action: "PAUSE_SESSION" };
    }

    if (matrix.browserFailures >= 3) {
      matrix.detailBrowser = "DEGRADED";
      return { action: "RESET_CONTEXT" };
    }

    return { action: "REPLACE_PAGE" };
  }

  recordFailure(
    portal: string,
    reason: string,
  ): {
    action:
      | "REPLACE_PAGE"
      | "RESET_CONTEXT"
      | "PAUSE_SESSION"
      | "IGNORE";
  } {
    const itemLevelFailures = new Set([
      "EMPTY_CONTENT",
      "PARTIAL_CONTENT",
      "REMOVED_404",
      "INSUFFICIENT_CONTENT",
      "IDENTITY_UNRESOLVED",
      "UNRESOLVED_EXTERNAL_LISTING_IDENTITY",
      "REDIRECT_HOP_LIMIT",
      "UNSAFE_REDIRECT_DESTINATION",
      "FASTPATH_ACCESS_DENIED",
    ]);

    if (itemLevelFailures.has(reason)) {
      return { action: "IGNORE" };
    }

    return this.recordBrowserFailure(portal, reason);
  }
}

export class HealthManager {
  private static readonly runs =
    new Map<string, RunHealthManager>();

  private static defaultRun = new RunHealthManager("default");

  private static sweeperTimer:
    | NodeJS.Timeout
    | null = null;

  static forRun(runId: string): RunHealthManager {
    if (!runId) return this.defaultRun;
    let manager = this.runs.get(runId);

    if (!manager) {
      manager = new RunHealthManager(runId);
      this.runs.set(runId, manager);
    }

    return manager;
  }

  static clearRun(runId: string): void {
    this.runs.delete(runId);
  }

  static startLeaseSweeper(intervalMs = 60_000): void {
    if (this.sweeperTimer) return;

    this.sweeperTimer = setInterval(async () => {
      try {
        const repos = getRepositories();
        await repos.acquisition.reclaimExpiredLeases();
      } catch (err: any) {
        console.error(
          "[HealthManager] lease sweeper failed:",
          err.message,
        );
      }
    }, intervalMs);
  }

  static stopLeaseSweeper(): void {
    if (!this.sweeperTimer) return;
    clearInterval(this.sweeperTimer);
    this.sweeperTimer = null;
  }

  static resetForTests(): void {
    this.runs.clear();
    this.defaultRun = new RunHealthManager("default");
    this.stopLeaseSweeper();
  }

  static reset(): void {
    this.resetForTests();
  }

  // Legacy convenience delegates
  static getMatrix(portal: string, runId?: string): PortalCapabilityMatrix {
    return (runId ? this.forRun(runId) : this.defaultRun).getMatrix(portal);
  }

  static isFastPathAvailable(portal: string, runId?: string): boolean {
    return (runId ? this.forRun(runId) : this.defaultRun).isFastPathAvailable(portal);
  }

  static recordFastPathSuccess(portal: string, runId?: string): void {
    (runId ? this.forRun(runId) : this.defaultRun).recordFastPathSuccess(portal);
  }

  static recordFastPathFailure(portal: string, reason: string | number, runId?: string): void {
    (runId ? this.forRun(runId) : this.defaultRun).recordFastPathFailure(portal, reason);
  }

  static recordBrowserSuccess(portal: string, runId?: string): void {
    (runId ? this.forRun(runId) : this.defaultRun).recordBrowserSuccess(portal);
  }

  static recordBrowserFailure(portal: string, reason: string, runId?: string): { action: "REPLACE_PAGE" | "RESET_CONTEXT" | "PAUSE_SESSION" } {
    return (runId ? this.forRun(runId) : this.defaultRun).recordBrowserFailure(portal, reason);
  }

  static recordFailure(portal: string, reason: string, runId?: string): { action: "REPLACE_PAGE" | "RESET_CONTEXT" | "PAUSE_SESSION" | "IGNORE" } {
    return (runId ? this.forRun(runId) : this.defaultRun).recordFailure(portal, reason);
  }
}
