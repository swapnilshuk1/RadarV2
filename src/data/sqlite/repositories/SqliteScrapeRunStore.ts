/**
 * src/data/sqlite/repositories/SqliteScrapeRunStore.ts
 *
 * RADAR v2 — Phase 4A: Durable Multi-Tenant Scrape Runs & Events Repository.
 *
 * Invariants:
 * 1. Scope Enforcement: All operations enforce tenant_id and person_id from AuthorizedPersonScope.
 * 2. Atomic Uniqueness: The database partial unique index `idx_scrape_runs_active_scope`
 *    strictly guarantees AT MOST ONE active run per (tenant_id, person_id).
 * 3. Terminal Immutability: Completed/failed/aborted runs cannot transition back to active states.
 */

import type { DatabaseAdapter } from "../../database/adapter";
import type { AuthorizedPersonScope } from "../../../lib/security/auth";

export type ScrapeRunStatus =
  | "queued"
  | "initializing"
  | "running"
  | "waiting_for_confirmation"
  | "stopping"
  | "aborted"
  | "completed"
  | "failed";

export const ACTIVE_SCRAPE_STATUSES: readonly ScrapeRunStatus[] = [
  "queued",
  "initializing",
  "running",
  "waiting_for_confirmation",
];

export const TERMINAL_SCRAPE_STATUSES: readonly ScrapeRunStatus[] = [
  "completed",
  "failed",
  "aborted",
];

export class ActiveScrapeRunExistsError extends Error {
  constructor(
    public readonly tenantId: string,
    public readonly personId: string,
    public readonly existingRunId?: string
  ) {
    super(
      `An active scraping run already exists for tenant '${tenantId}' and person '${personId}'.`
    );
    this.name = "ActiveScrapeRunExistsError";
  }
}

export interface ScrapeRun {
  id: string;
  tenantId: string;
  personId: string;
  searchPlanId: string;
  status: ScrapeRunStatus;
  portalTargets: string[];
  configJson: string;
  metricsJson: string;
  totalDiscovered: number;
  totalEnqueued: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface ScrapeRunEvent {
  id: number;
  runId: string;
  tenantId: string;
  personId: string;
  stage: string;
  portal: string | null;
  eventType: string;
  payloadJson: string;
  createdAt: string;
}

export interface CreateScrapeRunParams {
  id?: string;
  searchPlanId: string;
  portalTargets: string[];
  config?: Record<string, unknown>;
  initialStatus?: ScrapeRunStatus;
}

export class SqliteScrapeRunStore {
  constructor(private db: DatabaseAdapter) {}

  /**
   * Atomically creates a new scrape run for the authorized scope.
   * Relies on the database partial unique index to reject concurrent active runs.
   */
  async createRun(
    scope: AuthorizedPersonScope,
    params: CreateScrapeRunParams
  ): Promise<ScrapeRun> {
    const runId = params.id || `run-${Date.now()}`;
    const now = new Date().toISOString();
    const status = params.initialStatus || "initializing";
    const portalsJson = JSON.stringify(params.portalTargets);
    const configJson = JSON.stringify(params.config || {});

    try {
      await this.db.execute(
        `INSERT INTO scrape_runs (
          id, tenant_id, person_id, search_plan_id, status,
          portal_targets, config_json, metrics_json, total_discovered, total_enqueued,
          created_at, started_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '{}', 0, 0, ?, ?, ?)`,
        [
          runId,
          scope.tenantId,
          scope.personId,
          params.searchPlanId,
          status,
          portalsJson,
          configJson,
          now,
          status === "running" || status === "initializing" ? now : null,
          now,
        ]
      );
    } catch (err: any) {
      if (
        err?.message?.includes("UNIQUE constraint failed") ||
        err?.message?.includes("idx_scrape_runs_active_scope")
      ) {
        const active = await this.getActiveRun(scope);
        throw new ActiveScrapeRunExistsError(scope.tenantId, scope.personId, active?.id);
      }
      throw err;
    }

    const created = await this.getRun(scope, runId);
    return created!;
  }

  /**
   * Retrieves a scrape run strictly within authorized tenant and person boundaries.
   */
  async getRun(scope: AuthorizedPersonScope, runId: string): Promise<ScrapeRun | null> {
    const row = await this.db.one<any>(
      `SELECT * FROM scrape_runs 
       WHERE id = ? AND tenant_id = ? AND person_id = ?`,
      [runId, scope.tenantId, scope.personId]
    );
    if (!row) return null;
    return this.mapRunRow(row);
  }

  /**
   * Retrieves the most recent scrape run for the authorized scope.
   */
  async getLatestRun(scope: AuthorizedPersonScope): Promise<ScrapeRun | null> {
    const row = await this.db.one<any>(
      `SELECT * FROM scrape_runs 
       WHERE tenant_id = ? AND person_id = ? 
       ORDER BY created_at DESC LIMIT 1`,
      [scope.tenantId, scope.personId]
    );
    if (!row) return null;
    return this.mapRunRow(row);
  }

  /**
   * Retrieves currently active run for the scope, if any.
   */
  async getActiveRun(scope: AuthorizedPersonScope): Promise<ScrapeRun | null> {
    const placeholders = ACTIVE_SCRAPE_STATUSES.map(() => "?").join(", ");
    const row = await this.db.one<any>(
      `SELECT * FROM scrape_runs 
       WHERE tenant_id = ? AND person_id = ? 
         AND status IN (${placeholders})
       LIMIT 1`,
      [scope.tenantId, scope.personId, ...ACTIVE_SCRAPE_STATUSES]
    );
    if (!row) return null;
    return this.mapRunRow(row);
  }

  /**
   * Checks if an active scrape run exists for the authorized scope.
   */
  async hasActiveRun(scope: AuthorizedPersonScope): Promise<boolean> {
    const active = await this.getActiveRun(scope);
    return active !== null;
  }

  /**
   * Updates scrape run status with terminal state protection.
   * Once terminal (completed, failed, aborted), status cannot be altered.
   */
  async updateRunStatus(
    scope: AuthorizedPersonScope,
    runId: string,
    status: ScrapeRunStatus,
    errorMessage?: string
  ): Promise<boolean> {
    const now = new Date().toISOString();
    const isTerminal = TERMINAL_SCRAPE_STATUSES.includes(status);
    const terminalPlaceholders = TERMINAL_SCRAPE_STATUSES.map(() => "?").join(", ");

    const res = await this.db.execute(
      `UPDATE scrape_runs 
       SET status = ?,
           error_message = COALESCE(?, error_message),
           finished_at = CASE WHEN ? = 1 THEN ? ELSE finished_at END,
           started_at = CASE WHEN ? = 'running' AND started_at IS NULL THEN ? ELSE started_at END,
           updated_at = ?
       WHERE id = ? AND tenant_id = ? AND person_id = ?
         AND status NOT IN (${terminalPlaceholders})`,
      [
        status,
        errorMessage || null,
        isTerminal ? 1 : 0,
        now,
        status,
        now,
        now,
        runId,
        scope.tenantId,
        scope.personId,
        ...TERMINAL_SCRAPE_STATUSES,
      ]
    );

    return res.rowsAffected > 0;
  }

  /**
   * Updates run metrics and discovery progress.
   */
  async updateRunMetrics(
    scope: AuthorizedPersonScope,
    runId: string,
    params: {
      totalDiscovered?: number;
      totalEnqueued?: number;
      metrics?: Record<string, unknown>;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    const updates: string[] = ["updated_at = ?"];
    const values: any[] = [now];

    if (params.totalDiscovered !== undefined) {
      updates.push("total_discovered = ?");
      values.push(params.totalDiscovered);
    }
    if (params.totalEnqueued !== undefined) {
      updates.push("total_enqueued = ?");
      values.push(params.totalEnqueued);
    }
    if (params.metrics !== undefined) {
      updates.push("metrics_json = ?");
      values.push(JSON.stringify(params.metrics));
    }

    values.push(runId, scope.tenantId, scope.personId);

    await this.db.execute(
      `UPDATE scrape_runs 
       SET ${updates.join(", ")}
       WHERE id = ? AND tenant_id = ? AND person_id = ?`,
      values
    );
  }

  /**
   * Records a progress or audit event for the run.
   */
  async recordEvent(
    scope: AuthorizedPersonScope,
    runId: string,
    event: {
      stage: string;
      portal?: string | null;
      eventType: string;
      payload?: Record<string, unknown>;
    }
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.db.execute(
      `INSERT INTO scrape_run_events (
        run_id, tenant_id, person_id, stage, portal, event_type, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        runId,
        scope.tenantId,
        scope.personId,
        event.stage,
        event.portal || null,
        event.eventType,
        JSON.stringify(event.payload || {}),
        now,
      ]
    );
  }

  /**
   * Lists events for a run in deterministic chronological order.
   */
  async listEvents(
    scope: AuthorizedPersonScope,
    runId: string
  ): Promise<ScrapeRunEvent[]> {
    const rows = await this.db.many<any>(
      `SELECT * FROM scrape_run_events 
       WHERE run_id = ? AND tenant_id = ? AND person_id = ?
       ORDER BY id ASC`,
      [runId, scope.tenantId, scope.personId]
    );

    return rows.map((r) => ({
      id: r.id,
      runId: r.run_id,
      tenantId: r.tenant_id,
      personId: r.person_id,
      stage: r.stage,
      portal: r.portal,
      eventType: r.event_type,
      payloadJson: r.payload_json,
      createdAt: r.created_at,
    }));
  }

  private mapRunRow(row: any): ScrapeRun {
    let portalTargets: string[] = [];
    try {
      portalTargets = JSON.parse(row.portal_targets || "[]");
    } catch {}

    return {
      id: row.id,
      tenantId: row.tenant_id,
      personId: row.person_id,
      searchPlanId: row.search_plan_id,
      status: row.status as ScrapeRunStatus,
      portalTargets,
      configJson: row.config_json || "{}",
      metricsJson: row.metrics_json || "{}",
      totalDiscovered: Number(row.total_discovered || 0),
      totalEnqueued: Number(row.total_enqueued || 0),
      errorMessage: row.error_message || null,
      createdAt: row.created_at,
      startedAt: row.started_at || null,
      finishedAt: row.finished_at || null,
      updatedAt: row.updated_at,
    };
  }
}
