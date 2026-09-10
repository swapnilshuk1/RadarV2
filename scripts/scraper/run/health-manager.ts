/**
 * scripts/scraper/run/health-manager.ts
 * 
 * Multi-Layer Capability Health Matrix & FastPath Circuit Breaker.
 * 
 * Target Isolation Rules:
 * 1. FastPath Detail Failures (HTTP 403 / 0 chars) ONLY degrade/disable detailFastPath.
 *    They NEVER trigger Page replacement, Context reset, or Session pause!
 * 2. Naukri / Indeed Discovery Health is completely isolated from Detail Acquisition Health.
 * 3. Browser navigation errors only trigger Page replacement if repeated across different pages.
 * 4. Run Isolation: matrices and circuit breaker states are bound to specific run instances.
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
  readonly runId: string;
  private matrixMap: Map<string, PortalCapabilityMatrix> = new Map();

  constructor(runId: string) {
    this.runId = runId;
  }

  getMatrix(portal: string): PortalCapabilityMatrix {
    if (!this.matrixMap.has(portal)) {
      this.matrixMap.set(portal, {
        portal,
        discovery: "HEALTHY",
        detailFastPath: "HEALTHY",
        fastPathCircuit: "CLOSED",
        detailBrowser: "HEALTHY",
        session: "READY",
        fastPathFailures: 0,
        fastPathHistory: [],
        browserFailures: 0,
      });
    }
    return this.matrixMap.get(portal)!;
  }

  isFastPathAvailable(portal: string): boolean {
    const matrix = this.getMatrix(portal);
    if (matrix.fastPathCircuit === "OPEN") {
      if (matrix.fastPathCooldownUntil && Date.now() > matrix.fastPathCooldownUntil) {
        // Cooldown expired: Probe FastPath in HALF_OPEN state
        matrix.fastPathCircuit = "HALF_OPEN";
        matrix.detailFastPath = "DEGRADED";
        console.log(`🔌 [HealthManager:${this.runId}] FastPath Circuit HALF_OPEN for ${portal}. Probing FastPath...`);
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
    if (matrix.fastPathHistory.length > 10) matrix.fastPathHistory.shift();

    matrix.fastPathCircuit = "CLOSED";
    matrix.detailFastPath = "HEALTHY";
    matrix.fastPathCooldownUntil = undefined;
  }

  recordFastPathFailure(portal: string, reason: string | number): void {
    const matrix = this.getMatrix(portal);
    matrix.fastPathFailures += 1;
    matrix.fastPathHistory.push(false);
    if (matrix.fastPathHistory.length > 10) matrix.fastPathHistory.shift();

    const failuresInHistory = matrix.fastPathHistory.filter(f => !f).length;
    const failureRate = failuresInHistory / Math.max(1, matrix.fastPathHistory.length);
    const reasonStr = String(reason ?? "");

    // Immediate trip on 403 or >=5 consecutive or >=70% failure rate
    if (reasonStr.includes("403") || matrix.fastPathFailures >= 5 || (matrix.fastPathHistory.length >= 5 && failureRate >= 0.70)) {
      matrix.fastPathCircuit = "OPEN";
      matrix.detailFastPath = "DISABLED";
      matrix.fastPathCooldownUntil = Date.now() + 300000; // 5 minute circuit breaker cooldown
      console.warn(`⚡ [HealthManager:${this.runId}] FastPath Circuit OPEN for ${portal} (${reasonStr}, failureRate: ${(failureRate * 100).toFixed(0)}%). FastPath DISABLED for 5m. Browser detail worker active.`);
    } else {
      matrix.detailFastPath = "DEGRADED";
      console.warn(`⚠️ [HealthManager:${this.runId}] FastPath failure #${matrix.fastPathFailures} for ${portal} (${reasonStr}).`);
    }
  }

  recordSuccess(portal: string): void {
    this.recordBrowserSuccess(portal);
  }

  recordFailure(portal: string, reason: string): { action: "REPLACE_PAGE" | "RESET_CONTEXT" | "PAUSE_SESSION" | "IGNORE" } {
    const itemLevelFailures = [
      "EMPTY_CONTENT",
      "PARTIAL_CONTENT",
      "REMOVED_404",
      "UNKNOWN_FAILURE",
      "INSUFFICIENT_CONTENT",
      "IDENTITY_UNRESOLVED",
      "UNRESOLVED_EXTERNAL_LISTING_IDENTITY",
      "REDIRECT_HOP_LIMIT",
      "UNSAFE_REDIRECT_DESTINATION",
    ];
    if (itemLevelFailures.includes(reason)) {
      return { action: "IGNORE" };
    }
    return this.recordBrowserFailure(portal, reason);
  }

  recordBrowserSuccess(portal: string): void {
    const matrix = this.getMatrix(portal);
    matrix.browserFailures = 0;
    matrix.detailBrowser = "HEALTHY";
  }

  recordBrowserFailure(portal: string, reason: string): { action: "REPLACE_PAGE" | "RESET_CONTEXT" | "PAUSE_SESSION" } {
    const matrix = this.getMatrix(portal);
    matrix.browserFailures += 1;

    if (reason.includes("BOT_CHALLENGE") || reason.includes("LOGIN_REQUIRED") || matrix.browserFailures >= 6) {
      matrix.session = "GATED";
      matrix.pauseReason = `Session challenge / login required: ${reason}`;
      console.warn(`🚨 [HealthManager:${this.runId}] Portal ${portal} session gated (${reason}).`);
      return { action: "PAUSE_SESSION" };
    }

    if (matrix.browserFailures >= 3) {
      matrix.detailBrowser = "DEGRADED";
      console.warn(`⚠️ [HealthManager:${this.runId}] Portal ${portal} browser context degraded. Triggering Tier 2 Context Reset.`);
      return { action: "RESET_CONTEXT" };
    }

    console.warn(`⚠️ [HealthManager:${this.runId}] Portal ${portal} browser page failure #${matrix.browserFailures}. Triggering Tier 1 Page Replacement.`);
    return { action: "REPLACE_PAGE" };
  }
}

export class HealthManager {
  private static runManagers: Map<string, RunHealthManager> = new Map();
  private static defaultRunManager: RunHealthManager = new RunHealthManager("global");
  private static sweeperTimer: NodeJS.Timeout | null = null;

  static forRun(runId: string): RunHealthManager {
    if (!runId) return this.defaultRunManager;
    if (!this.runManagers.has(runId)) {
      this.runManagers.set(runId, new RunHealthManager(runId));
    }
    return this.runManagers.get(runId)!;
  }

  static clearRun(runId: string): void {
    this.runManagers.delete(runId);
  }

  static reset(): void {
    this.runManagers.clear();
    this.defaultRunManager = new RunHealthManager("global");
    this.stopLeaseSweeper();
  }

  static getMatrix(portal: string, runId?: string): PortalCapabilityMatrix {
    return (runId ? this.forRun(runId) : this.defaultRunManager).getMatrix(portal);
  }

  static isFastPathAvailable(portal: string, runId?: string): boolean {
    return (runId ? this.forRun(runId) : this.defaultRunManager).isFastPathAvailable(portal);
  }

  static recordFastPathSuccess(portal: string, runId?: string): void {
    (runId ? this.forRun(runId) : this.defaultRunManager).recordFastPathSuccess(portal);
  }

  static recordFastPathFailure(portal: string, reason: string | number, runId?: string): void {
    (runId ? this.forRun(runId) : this.defaultRunManager).recordFastPathFailure(portal, reason);
  }

  static recordSuccess(portal: string, runId?: string): void {
    (runId ? this.forRun(runId) : this.defaultRunManager).recordSuccess(portal);
  }

  static recordFailure(portal: string, reason: string, runId?: string): { action: "REPLACE_PAGE" | "RESET_CONTEXT" | "PAUSE_SESSION" | "IGNORE" } {
    return (runId ? this.forRun(runId) : this.defaultRunManager).recordFailure(portal, reason);
  }

  static recordBrowserSuccess(portal: string, runId?: string): void {
    (runId ? this.forRun(runId) : this.defaultRunManager).recordBrowserSuccess(portal);
  }

  static recordBrowserFailure(portal: string, reason: string, runId?: string): { action: "REPLACE_PAGE" | "RESET_CONTEXT" | "PAUSE_SESSION" } {
    return (runId ? this.forRun(runId) : this.defaultRunManager).recordBrowserFailure(portal, reason);
  }

  /**
   * Background lease sweeper that runs every 60 seconds to reclaim abandoned worker leases.
   * Process-scoped.
   */
  static startLeaseSweeper(intervalMs = 60000): void {
    if (this.sweeperTimer) return;
    this.sweeperTimer = setInterval(async () => {
      try {
        const repos = getRepositories();
        const reclaimed = await repos.acquisition.reclaimExpiredLeases();
        if (reclaimed > 0) {
          console.log(`🧹 [HealthManager] Sweeper reclaimed ${reclaimed} expired job leases back to QUEUED.`);
        }
      } catch (err: any) {
        console.error("⚠️ [HealthManager] Lease sweeper error:", err.message);
      }
    }, intervalMs);
  }

  static stopLeaseSweeper(): void {
    if (this.sweeperTimer) {
      clearInterval(this.sweeperTimer);
      this.sweeperTimer = null;
    }
  }
}
