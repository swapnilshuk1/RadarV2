import type { DatabaseAdapter } from "../../../src/data/database/adapter";
import { getDatabaseAdapter } from "../../../src/data/database";

export type JobStatus = "PENDING" | "LEASED" | "RUNNING" | "FAILED" | "RETRY" | "COMPLETE";
export type FailureType = "RATE_LIMIT" | "NETWORK" | "LLM_TIMEOUT" | "PROMPT_TOO_LONG" | "PARSE_FAILURE" | "UNKNOWN" | null;

export interface EnrichmentJob {
  id: string;
  job_hash: string;
  canonical_job_id?: string | null;
  opportunity_version?: string | null;
  pipeline_version: string;
  snapshot_path: string;
  payload_key: string;
  run_id: string;
  execution_plan_id: string;
  definition_id: string;
  family_id: string;
  portal: string;
  page: number;
  catalog_version: string;
  planner_version: string;
  rule_version: string;
  search_query: string;
  status: JobStatus;
  business_priority: number;
  execution_priority: number;
  attempts: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  last_error: string | null;
  failure_type: FailureType;
  next_retry_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
}

export class EnrichmentQueue {
  private db: DatabaseAdapter;

  constructor(adapter?: DatabaseAdapter) {
    this.db = adapter || getDatabaseAdapter();
  }

  public getDatabaseAdapter(): DatabaseAdapter {
    return this.db;
  }

  public async enqueue(
    id: string,
    jobHash: string,
    snapshotPathOrPayloadKey: string,
    pipelineVersion: string,
    provenance: {
      runId: string;
      executionPlanId: string;
      definitionId: string;
      familyId: string;
      portal: string;
      page: number;
      catalogVersion: string;
      plannerVersion: string;
      ruleVersion: string;
      searchQuery: string;
    },
    businessPriority: number = 0,
    executionPriority: number = 0,
    explicitPayloadKey?: string,
    canonicalJobId?: string,
    opportunityVersion?: string
  ): Promise<boolean> {
    try {
      const payloadKey = explicitPayloadKey || (snapshotPathOrPayloadKey.startsWith("snapshots/") || snapshotPathOrPayloadKey.startsWith("blobs/")
        ? snapshotPathOrPayloadKey
        : `snapshots/${jobHash}.json`);
      const snapshotPath = snapshotPathOrPayloadKey;

      // 1. Version-Aware Shared Work Resolution:
      // If canonicalJobId + opportunityVersion provided, check if matching job exists
      let existingJob: { id: string } | null = null;
      if (canonicalJobId && opportunityVersion) {
        existingJob = await this.db.one<{ id: string }>(
          `SELECT id FROM enrichment_jobs 
           WHERE canonical_job_id = ? AND opportunity_version = ? AND pipeline_version = ?
           LIMIT 1`,
          [canonicalJobId, opportunityVersion, pipelineVersion]
        );
      }

      if (!existingJob) {
        existingJob = await this.db.one<{ id: string }>(
          `SELECT id FROM enrichment_jobs WHERE job_hash = ? LIMIT 1`,
          [jobHash]
        );
      }

      if (existingJob) {
        // Shared work already exists: bind this run to the existing job if run exists
        if (provenance?.runId) {
          const runExists = await this.db.one<{ id: string }>(
            `SELECT id FROM scrape_runs WHERE id = ? LIMIT 1`,
            [provenance.runId]
          );
          if (runExists) {
            await this.db.execute(
              `INSERT OR IGNORE INTO scrape_run_enrichment_requirements (run_id, enrichment_job_id)
               VALUES (?, ?)`,
              [provenance.runId, existingJob.id]
            );
          }
        }
        return false;
      }

      // 2. Insert new enrichment job
      const res = await this.db.execute(
        `INSERT INTO enrichment_jobs 
        (id, job_hash, canonical_job_id, opportunity_version, pipeline_version, snapshot_path, payload_key,
         run_id, execution_plan_id, definition_id, family_id, portal, page,
         catalog_version, planner_version, rule_version, search_query,
         status, business_priority, execution_priority, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(job_hash) DO NOTHING`,
        [
          id,
          jobHash,
          canonicalJobId || null,
          opportunityVersion || null,
          pipelineVersion,
          snapshotPath,
          payloadKey,
          provenance.runId,
          provenance.executionPlanId,
          provenance.definitionId,
          provenance.familyId,
          provenance.portal,
          provenance.page,
          provenance.catalogVersion,
          provenance.plannerVersion,
          provenance.ruleVersion,
          provenance.searchQuery,
          businessPriority,
          executionPriority,
        ]
      );

      // Determine the resolved job id (either the newly inserted id or existing on conflict)
      let resolvedJobId = id;
      if (res.rowsAffected === 0) {
        const found = await this.db.one<{ id: string }>(
          `SELECT id FROM enrichment_jobs WHERE job_hash = ? LIMIT 1`,
          [jobHash]
        );
        if (found) resolvedJobId = found.id;
      }

      // Bind run to the resolved enrichment job if run exists
      if (provenance?.runId) {
        const runExists = await this.db.one<{ id: string }>(
          `SELECT id FROM scrape_runs WHERE id = ? LIMIT 1`,
          [provenance.runId]
        );
        if (runExists) {
          await this.db.execute(
            `INSERT OR IGNORE INTO scrape_run_enrichment_requirements (run_id, enrichment_job_id)
             VALUES (?, ?)`,
            [provenance.runId, resolvedJobId]
          );
        }
      }

      if (res.rowsAffected > 0) {
        await this.logEvent(id, "JOB_QUEUED");
        return true;
      }
      return false; // Reused existing job
    } catch (err: any) {
      if (err.message?.includes("UNIQUE constraint failed") || err.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return false; // Already enqueued
      }
      throw err;
    }
  }

  public async leaseJobs(workerId: string, limit: number, leaseDurationSeconds: number = 300): Promise<EnrichmentJob[]> {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + leaseDurationSeconds * 1000).toISOString();

    const leased = await this.db.many<EnrichmentJob>(
      `UPDATE enrichment_jobs
      SET status = 'LEASED',
          lease_owner = ?,
          lease_expires_at = ?
      WHERE id IN (
        SELECT id FROM enrichment_jobs
        WHERE (status = 'PENDING')
           OR (status = 'RETRY' AND (next_retry_at IS NULL OR next_retry_at <= ?))
           OR (status = 'LEASED' AND lease_expires_at < ?)
           OR (status = 'RUNNING' AND lease_expires_at < ?)
        ORDER BY (business_priority + execution_priority) DESC, created_at ASC
        LIMIT ?
      )
      RETURNING *`,
      [workerId, expiresAt, now, now, now, limit]
    );

    for (const job of leased) {
      await this.logEvent(job.id, "LEASE_ACQUIRED", JSON.stringify({ workerId, expiresAt }));
    }
    return leased;
  }

  public async markRunning(jobId: string): Promise<void> {
    await this.db.execute(
      `UPDATE enrichment_jobs SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [jobId]
    );
    await this.logEvent(jobId, "LLM_STARTED");
  }

  public async markCompleted(jobId: string, lastError?: string | null): Promise<void> {
    await this.db.execute(
      `UPDATE enrichment_jobs 
      SET status = 'COMPLETE', 
          completed_at = CURRENT_TIMESTAMP,
          last_error = ?,
          failure_type = NULL,
          lease_owner = NULL,
          lease_expires_at = NULL
      WHERE id = ?`,
      [lastError || null, jobId]
    );
    await this.logEvent(jobId, "JOB_FINISHED", lastError || undefined);

    // Release dependent evaluation requirements: WAITING_ENRICHMENT -> READY and create pending evaluation_jobs
    await this.releaseEvaluationRequirementsForJob(jobId);
  }

  public async releaseEvaluationRequirementsForJob(jobId: string): Promise<number> {
    const job = await this.db.one<{ canonical_job_id?: string; opportunity_version?: string }>(
      `SELECT canonical_job_id, opportunity_version FROM enrichment_jobs WHERE id = ?`,
      [jobId]
    );
    if (!job || !job.canonical_job_id || !job.opportunity_version) return 0;
    return await this.releaseEvaluationRequirements(job.canonical_job_id, job.opportunity_version);
  }

  public async releaseEvaluationRequirements(canonicalJobId: string, opportunityVersion: string): Promise<number> {
    const reqs = await this.db.many<{
      id: string;
      tenant_id: string;
      person_id: string;
      search_plan_id: string;
      canonical_job_id: string;
      opportunity_version: string;
      evaluation_context_fingerprint: string;
    }>(
      `SELECT * FROM evaluation_requirements 
       WHERE canonical_job_id = ? AND opportunity_version = ? AND status = 'WAITING_ENRICHMENT'`,
      [canonicalJobId, opportunityVersion]
    );

    if (reqs.length === 0) return 0;

    await this.db.execute(
      `UPDATE evaluation_requirements 
       SET status = 'READY', ready_at = CURRENT_TIMESTAMP 
       WHERE canonical_job_id = ? AND opportunity_version = ? AND status = 'WAITING_ENRICHMENT'`,
      [canonicalJobId, opportunityVersion]
    );

    for (const req of reqs) {
      const evalJobId = `eval_${req.tenant_id}_${req.canonical_job_id}_${req.opportunity_version}_${req.evaluation_context_fingerprint.substring(0, 8)}`.replace(/[^a-zA-Z0-9_-]/g, "_");
      await this.db.execute(
        `INSERT INTO evaluation_jobs (
           id, tenant_id, person_id, search_plan_id, canonical_job_id,
           opportunity_version, evaluation_context_fingerprint, status, attempts, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
         DO UPDATE SET status = CASE WHEN evaluation_jobs.status = 'completed' THEN 'completed' ELSE 'pending' END, updated_at = CURRENT_TIMESTAMP`,
        [
          evalJobId,
          req.tenant_id,
          req.person_id,
          req.search_plan_id,
          req.canonical_job_id,
          req.opportunity_version,
          req.evaluation_context_fingerprint,
        ]
      );
    }

    return reqs.length;
  }

  public async markRetry(jobId: string, failureType: FailureType, errorMsg: string, nextRetryAt: string): Promise<void> {
    await this.db.execute(
      `UPDATE enrichment_jobs 
      SET status = 'RETRY', 
          failure_type = ?, 
          last_error = ?, 
          next_retry_at = ?,
          attempts = attempts + 1,
          lease_owner = NULL,
          lease_expires_at = NULL
      WHERE id = ?`,
      [failureType, errorMsg, nextRetryAt, jobId]
    );

    const eventType = failureType === "RATE_LIMIT" ? "LLM_RATE_LIMITED" : "RETRY_SCHEDULED";
    await this.logEvent(jobId, eventType, JSON.stringify({ errorMsg, nextRetryAt }));
  }

  public async markFailed(jobId: string, failureType: FailureType, errorMsg: string): Promise<void> {
    await this.db.execute(
      `UPDATE enrichment_jobs 
      SET status = 'FAILED', 
          completed_at = CURRENT_TIMESTAMP,
          failure_type = ?, 
          last_error = ?,
          attempts = attempts + 1,
          lease_owner = NULL,
          lease_expires_at = NULL
      WHERE id = ?`,
      [failureType, errorMsg, jobId]
    );
    await this.logEvent(jobId, "JOB_FAILED", JSON.stringify({ errorMsg }));

    // Fail-Closed: mark dependent evaluation requirements FAILED
    const job = await this.db.one<{ canonical_job_id?: string; opportunity_version?: string }>(
      `SELECT canonical_job_id, opportunity_version FROM enrichment_jobs WHERE id = ?`,
      [jobId]
    );
    if (job?.canonical_job_id && job?.opportunity_version) {
      await this.db.execute(
        `UPDATE evaluation_requirements 
         SET status = 'FAILED', blocked_reason = 'ENRICHMENT_FAILED'
         WHERE canonical_job_id = ? AND opportunity_version = ? AND status = 'WAITING_ENRICHMENT'`,
        [job.canonical_job_id, job.opportunity_version]
      );
    }

    // Fail referencing runs
    await this.db.execute(
      `UPDATE scrape_runs
       SET status = 'failed', error_message = 'ENRICHMENT_FAILED: ' || ?, finished_at = CURRENT_TIMESTAMP
       WHERE id IN (
         SELECT run_id FROM scrape_run_enrichment_requirements WHERE enrichment_job_id = ?
       ) AND status NOT IN ('completed', 'failed', 'aborted')`,
      [errorMsg, jobId]
    );
  }

  /**
   * Only terminal jobs whose payload is not shared by active work are eligible
   * for retention cleanup. This prevents a filesystem cleanup from breaking a
   * pending, leased, running, or retrying enrichment job.
   */
  public async getExpiredTerminalPayloadKeys(cutoffIso: string): Promise<string[]> {
    const rows = await this.db.many<{ payload_key: string }>(
      `SELECT DISTINCT terminal.payload_key
       FROM enrichment_jobs AS terminal
       WHERE terminal.status IN ('COMPLETE', 'FAILED')
         AND terminal.payload_key IS NOT NULL
         AND terminal.payload_key != ''
         AND datetime(COALESCE(terminal.completed_at, terminal.created_at)) < datetime(?)
         AND NOT EXISTS (
           SELECT 1
           FROM enrichment_jobs AS active
           WHERE active.payload_key = terminal.payload_key
             AND active.status NOT IN ('COMPLETE', 'FAILED')
         )`,
      [cutoffIso],
    );
    return rows.map((row) => row.payload_key);
  }

  public async logEvent(jobId: string, eventType: string, details?: string): Promise<void> {
    try {
      await this.db.execute(
        `INSERT INTO enrichment_events (job_id, event_type, details, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
        [jobId, eventType, details || null]
      );
    } catch {}
  }

  public async getDashboardStats(): Promise<any> {
    const stats = await this.db.many<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count 
      FROM enrichment_jobs 
      GROUP BY status`
    );

    const ageStats = await this.db.one<{ avg_age_sec: number | null; max_age_sec: number | null }>(
      `SELECT 
        AVG(CAST(strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', created_at) AS INTEGER)) as avg_age_sec,
        MAX(CAST(strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', created_at) AS INTEGER)) as max_age_sec
      FROM enrichment_jobs
      WHERE status IN ('PENDING', 'RETRY', 'LEASED', 'RUNNING')`
    );

    const failureDist = await this.db.many<{ failure_type: string; total_failures: number; mean_retries: number; recovered: number; permanent: number }>(
      `SELECT 
        failure_type,
        COUNT(*) as total_failures,
        AVG(attempts) as mean_retries,
        SUM(CASE WHEN status IN ('COMPLETE', 'COMPLETED') THEN 1 ELSE 0 END) as recovered,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as permanent
      FROM enrichment_jobs
      WHERE failure_type IS NOT NULL
      GROUP BY failure_type`
    );

    // Throughput helper
    const getThroughput = async (minutes: number | null) => {
      const timeFilter = minutes ? `AND created_at >= datetime('now', '-${minutes} minutes')` : "";
      const completeTimeFilter = minutes ? `AND completed_at >= datetime('now', '-${minutes} minutes')` : "";

      const acquired = (await this.db.one<{ count: number }>(`SELECT COUNT(*) as count FROM enrichment_jobs WHERE 1=1 ${timeFilter}`)) || { count: 0 };
      const completed = (await this.db.one<{ count: number }>(`SELECT COUNT(*) as count FROM enrichment_jobs WHERE status IN ('COMPLETE', 'COMPLETED') ${completeTimeFilter}`)) || { count: 0 };

      let hours = minutes ? minutes / 60 : 1;
      if (!minutes) {
        const firstJob = await this.db.one<{ created_at: string }>(`SELECT created_at FROM enrichment_jobs ORDER BY created_at ASC LIMIT 1`);
        if (firstJob?.created_at) {
          const diffMs = Date.now() - new Date(firstJob.created_at + "Z").getTime();
          hours = Math.max(diffMs / (1000 * 60 * 60), 0.016);
        }
      }

      return {
        acquiredHr: Math.round(acquired.count / hours),
        completedHr: Math.round(completed.count / hours),
        driftHr: Math.round((acquired.count - completed.count) / hours),
      };
    };

    const [t5m, t30m, toverall] = await Promise.all([
      getThroughput(5),
      getThroughput(30),
      getThroughput(null),
    ]);

    return {
      counts: stats,
      age: ageStats || { avg_age_sec: null, max_age_sec: null },
      failureDistribution: failureDist,
      throughput: {
        last5m: t5m,
        last30m: t30m,
        overall: toverall,
      },
    };
  }

  public async getRunStats(runId: string): Promise<{
    total: number;
    completed: number;
    failed: number;
    processing: number;
    pending: number;
    latestJobs: any[];
  }> {
    const [total, completed, failed, processing, pending, latestJobs] = await Promise.all([
      this.db.one<{ count: number }>(
        `SELECT COUNT(DISTINCT ej.id) as count 
         FROM enrichment_jobs ej 
         LEFT JOIN scrape_run_enrichment_requirements r ON r.enrichment_job_id = ej.id 
         WHERE ej.run_id = ? OR r.run_id = ?`,
        [runId, runId]
      ),
      this.db.one<{ count: number }>(
        `SELECT COUNT(DISTINCT ej.id) as count 
         FROM enrichment_jobs ej 
         LEFT JOIN scrape_run_enrichment_requirements r ON r.enrichment_job_id = ej.id 
         WHERE (ej.run_id = ? OR r.run_id = ?) AND ej.status = 'COMPLETE'`,
        [runId, runId]
      ),
      this.db.one<{ count: number }>(
        `SELECT COUNT(DISTINCT ej.id) as count 
         FROM enrichment_jobs ej 
         LEFT JOIN scrape_run_enrichment_requirements r ON r.enrichment_job_id = ej.id 
         WHERE (ej.run_id = ? OR r.run_id = ?) AND ej.status = 'FAILED'`,
        [runId, runId]
      ),
      this.db.one<{ count: number }>(
        `SELECT COUNT(DISTINCT ej.id) as count 
         FROM enrichment_jobs ej 
         LEFT JOIN scrape_run_enrichment_requirements r ON r.enrichment_job_id = ej.id 
         WHERE (ej.run_id = ? OR r.run_id = ?) AND ej.status IN ('LEASED', 'RUNNING')`,
        [runId, runId]
      ),
      this.db.one<{ count: number }>(
        `SELECT COUNT(DISTINCT ej.id) as count 
         FROM enrichment_jobs ej 
         LEFT JOIN scrape_run_enrichment_requirements r ON r.enrichment_job_id = ej.id 
         WHERE (ej.run_id = ? OR r.run_id = ?) AND ej.status IN ('PENDING', 'RETRY')`,
        [runId, runId]
      ),
      this.db.many<any>(
        `SELECT DISTINCT ej.id, ej.snapshot_path, ej.status, ej.last_error, ej.completed_at, ej.created_at
         FROM enrichment_jobs ej
         LEFT JOIN scrape_run_enrichment_requirements r ON r.enrichment_job_id = ej.id
         WHERE ej.run_id = ? OR r.run_id = ?
         ORDER BY ej.completed_at DESC, ej.created_at DESC
         LIMIT 3`,
        [runId, runId]
      ),
    ]);

    return {
      total: total?.count || 0,
      completed: completed?.count || 0,
      failed: failed?.count || 0,
      processing: processing?.count || 0,
      pending: pending?.count || 0,
      latestJobs: latestJobs || [],
    };
  }

  public async getGlobalPipelineStats(): Promise<any> {
    const counts = await this.db.many<{ status: string; count: number }>(
      `SELECT status, COUNT(*) as count 
      FROM enrichment_jobs 
      GROUP BY status`
    );

    const stateMap: Record<string, number> = {
      PENDING: 0,
      LEASED: 0,
      RUNNING: 0,
      RETRY: 0,
      COMPLETE: 0,
      FAILED: 0,
    };
    for (const row of counts) {
      stateMap[row.status] = row.count;
    }

    const oldestPendingRow = await this.db.one<{ age_sec: number | null }>(
      `SELECT CAST(strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', created_at) AS INTEGER) as age_sec
      FROM enrichment_jobs
      WHERE status IN ('PENDING', 'RETRY')
      ORDER BY created_at ASC
      LIMIT 1`
    );

    const failures = await this.db.many<{ failure_type: string | null; count: number }>(
      `SELECT failure_type, COUNT(*) as count
      FROM enrichment_jobs
      WHERE status = 'FAILED' OR status = 'RETRY'
      GROUP BY failure_type`
    );

    const errorDistribution: Record<string, number> = {};
    for (const f of failures) {
      errorDistribution[f.failure_type || "UNKNOWN"] = f.count;
    }

    const completions5m = (await this.db.one<{ count: number }>(
      `SELECT COUNT(*) as count 
      FROM enrichment_jobs 
      WHERE status = 'COMPLETE' 
        AND completed_at >= datetime('now', '-5 minutes')`
    )) || { count: 0 };

    const cacheHitStats = await this.db.one<{ cache_saves: number | null; total: number }>(
      `SELECT 
        SUM(CASE WHEN details LIKE '%cached%' OR details LIKE '%skipped LLM%' THEN 1 ELSE 0 END) as cache_saves,
        COUNT(*) as total
      FROM enrichment_events
      WHERE event_type = 'JOB_FINISHED'`
    );

    return {
      discovered: stateMap.PENDING + stateMap.RETRY + stateMap.LEASED + stateMap.RUNNING + stateMap.COMPLETE + stateMap.FAILED,
      pending: stateMap.PENDING,
      retry: stateMap.RETRY,
      leased: stateMap.LEASED,
      enriching: stateMap.RUNNING,
      completed: stateMap.COMPLETE,
      failed: stateMap.FAILED,
      oldestPendingSec: oldestPendingRow?.age_sec ?? null,
      throughputPerMin: Number(((completions5m?.count || 0) / 5).toFixed(1)),
      cacheHitRate: cacheHitStats?.total ? Math.round(((cacheHitStats.cache_saves || 0) / cacheHitStats.total) * 100) : 0,
      cacheSaves: cacheHitStats?.cache_saves || 0,
      errorDistribution,
    };
  }

  public async getPendingCountForRun(runId: string): Promise<number> {
    const res = await this.db.one<{ count: number }>(
      `SELECT COUNT(*) as count 
      FROM enrichment_jobs 
      WHERE run_id = ? AND status IN ('PENDING', 'RETRY')`,
      [runId]
    );
    return res?.count || 0;
  }

  public async hasRetriesForRun(runId: string): Promise<boolean> {
    const res = await this.db.one<{ count: number }>(
      `SELECT COUNT(*) as count 
      FROM enrichment_jobs 
      WHERE run_id = ? AND status = 'RETRY'`,
      [runId]
    );
    return (res?.count || 0) > 0;
  }

  public async leaseJobsForRun(workerId: string, runId: string, limit: number, leaseDurationSeconds: number = 300): Promise<EnrichmentJob[]> {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + leaseDurationSeconds * 1000).toISOString();

    const leased = await this.db.many<EnrichmentJob>(
      `UPDATE enrichment_jobs
      SET status = 'LEASED',
          lease_owner = ?,
          lease_expires_at = ?
      WHERE id IN (
        SELECT id FROM enrichment_jobs
        WHERE run_id = ? AND (
             (status = 'PENDING')
          OR (status = 'RETRY' AND (next_retry_at IS NULL OR next_retry_at <= ?))
          OR (status = 'LEASED' AND lease_expires_at < ?)
          OR (status = 'RUNNING' AND lease_expires_at < ?)
        )
        ORDER BY (business_priority + execution_priority) DESC, created_at ASC
        LIMIT ?
      )
      RETURNING *`,
      [workerId, expiresAt, runId, now, now, now, limit]
    );

    for (const job of leased) {
      await this.logEvent(job.id, "LEASE_ACQUIRED", JSON.stringify({ workerId, expiresAt }));
    }
    return leased;
  }

  public async recoverExpiredLeases(): Promise<number> {
    const now = new Date().toISOString();
    const result = await this.db.execute(
      `UPDATE enrichment_jobs
      SET status = 'PENDING',
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = 'Lease expired / worker reclaimed job'
      WHERE (status = 'LEASED' OR status = 'RUNNING') AND lease_expires_at < ?`,
      [now]
    );
    return result.rowsAffected;
  }
}
