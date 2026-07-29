import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export type JobStatus = "PENDING" | "LEASED" | "RUNNING" | "FAILED" | "RETRY" | "COMPLETE";
export type FailureType = "RATE_LIMIT" | "NETWORK" | "LLM_TIMEOUT" | "PROMPT_TOO_LONG" | "PARSE_FAILURE" | "UNKNOWN" | null;

export interface EnrichmentJob {
  id: string;
  job_hash: string;
  pipeline_version: string;
  snapshot_path: string;
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
  private db: Database.Database;

  constructor(dbPath?: string) {
    const defaultPath = path.join(process.cwd(), ".radar", "queue.db");
    const resolvedPath = dbPath || defaultPath;
    
    // Ensure dir exists
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.pragma("journal_mode = WAL");
    this.initSchema();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS enrichment_jobs (
        id TEXT PRIMARY KEY,
        job_hash TEXT UNIQUE,
        pipeline_version TEXT,
        snapshot_path TEXT,
        run_id TEXT,
        execution_plan_id TEXT,
        definition_id TEXT,
        family_id TEXT,
        portal TEXT,
        page INTEGER,
        catalog_version TEXT,
        planner_version TEXT,
        rule_version TEXT,
        search_query TEXT,
        status TEXT,
        business_priority INTEGER DEFAULT 0,
        execution_priority INTEGER DEFAULT 0,
        attempts INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        completed_at DATETIME,
        last_error TEXT,
        failure_type TEXT,
        next_retry_at DATETIME,
        lease_owner TEXT,
        lease_expires_at DATETIME
      );

      CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status ON enrichment_jobs(status, next_retry_at);
      CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_priority ON enrichment_jobs((business_priority + execution_priority) DESC, created_at ASC);

      CREATE TABLE IF NOT EXISTS enrichment_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT,
        event_type TEXT,
        details TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(job_id) REFERENCES enrichment_jobs(id)
      );
    `);

    // Self-healing migration for existing user databases lacking newly introduced columns
    const columns = this.db.prepare("PRAGMA table_info(enrichment_jobs)").all() as { name: string }[];
    const colNames = new Set(columns.map(c => c.name));

    const migrations = [
      { name: "last_error", type: "TEXT" },
      { name: "failure_type", type: "TEXT" },
      { name: "next_retry_at", type: "DATETIME" },
      { name: "lease_owner", type: "TEXT" },
      { name: "lease_expires_at", type: "DATETIME" }
    ];

    for (const m of migrations) {
      if (!colNames.has(m.name)) {
        console.log(`[Queue Migration] Adding missing column '${m.name}' to enrichment_jobs`);
        try {
          this.db.exec(`ALTER TABLE enrichment_jobs ADD COLUMN ${m.name} ${m.type}`);
        } catch (err: any) {
          console.error(`[Queue Migration] Failed to add column '${m.name}':`, err.message);
        }
      }
    }
  }

  public enqueue(
    id: string,
    jobHash: string,
    snapshotPath: string,
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
    executionPriority: number = 0
  ): boolean {
    try {
      const stmt = this.db.prepare(`
        INSERT INTO enrichment_jobs 
        (id, job_hash, pipeline_version, snapshot_path, 
         run_id, execution_plan_id, definition_id, family_id, portal, page,
         catalog_version, planner_version, rule_version, search_query,
         status, business_priority, execution_priority)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)
      `);
      stmt.run(
        id, jobHash, pipelineVersion, snapshotPath, 
        provenance.runId, provenance.executionPlanId, provenance.definitionId, provenance.familyId, provenance.portal, provenance.page,
        provenance.catalogVersion, provenance.plannerVersion, provenance.ruleVersion, provenance.searchQuery,
        businessPriority, executionPriority
      );
      this.logEvent(id, "JOB_QUEUED");
      return true;
    } catch (err: any) {
      if (err.code === "SQLITE_CONSTRAINT_UNIQUE" || err.message.includes("UNIQUE constraint failed")) {
        return false; // Already enqueued
      }
      throw err;
    }
  }

  public leaseJobs(workerId: string, limit: number, leaseDurationSeconds: number = 300): EnrichmentJob[] {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + leaseDurationSeconds * 1000).toISOString();

    const stmt = this.db.prepare(`
      UPDATE enrichment_jobs
      SET status = 'LEASED',
          lease_owner = ?,
          lease_expires_at = ?
      WHERE id IN (
        SELECT id FROM enrichment_jobs
        WHERE (status = 'PENDING')
           OR (status = 'RETRY' AND (next_retry_at IS NULL OR next_retry_at <= ?))
           OR (status = 'LEASED' AND lease_expires_at < ?)
        ORDER BY (business_priority + execution_priority) DESC, created_at ASC
        LIMIT ?
      )
      RETURNING *
    `);

    const leased = stmt.all(workerId, expiresAt, now, now, limit) as EnrichmentJob[];
    for (const job of leased) {
      this.logEvent(job.id, "LEASE_ACQUIRED", JSON.stringify({ workerId, expiresAt }));
    }
    return leased;
  }

  public markRunning(jobId: string) {
    this.db.prepare(`UPDATE enrichment_jobs SET status = 'RUNNING', started_at = CURRENT_TIMESTAMP WHERE id = ?`).run(jobId);
    this.logEvent(jobId, "LLM_STARTED");
  }

  public markCompleted(jobId: string, lastError?: string | null) {
    this.db.prepare(`
      UPDATE enrichment_jobs 
      SET status = 'COMPLETE', 
          completed_at = CURRENT_TIMESTAMP,
          last_error = ?
      WHERE id = ?
    `).run(lastError || null, jobId);
    this.logEvent(jobId, "JOB_FINISHED", lastError || undefined);
  }

  public markRetry(jobId: string, failureType: FailureType, errorMsg: string, nextRetryAt: string) {
    this.db.prepare(`
      UPDATE enrichment_jobs 
      SET status = 'RETRY', 
          failure_type = ?, 
          last_error = ?, 
          next_retry_at = ?,
          attempts = attempts + 1
      WHERE id = ?
    `).run(failureType, errorMsg, nextRetryAt, jobId);
    
    const eventType = failureType === "RATE_LIMIT" ? "LLM_RATE_LIMITED" : "RETRY_SCHEDULED";
    this.logEvent(jobId, eventType, JSON.stringify({ errorMsg, nextRetryAt }));
  }

  public markFailed(jobId: string, failureType: FailureType, errorMsg: string) {
    this.db.prepare(`
      UPDATE enrichment_jobs 
      SET status = 'FAILED', 
          failure_type = ?, 
          last_error = ?,
          attempts = attempts + 1
      WHERE id = ?
    `).run(failureType, errorMsg, jobId);
    this.logEvent(jobId, "JOB_FAILED", JSON.stringify({ errorMsg }));
  }

  public logEvent(jobId: string, eventType: string, details?: string) {
    this.db.prepare(`INSERT INTO enrichment_events (job_id, event_type, details) VALUES (?, ?, ?)`).run(jobId, eventType, details || null);
  }

  public getDashboardStats() {
    const stats = this.db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM enrichment_jobs 
      GROUP BY status
    `).all() as { status: string; count: number }[];

    const ageStats = this.db.prepare(`
      SELECT 
        AVG(CAST(strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', created_at) AS INTEGER)) as avg_age_sec,
        MAX(CAST(strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', created_at) AS INTEGER)) as max_age_sec
      FROM enrichment_jobs
      WHERE status IN ('PENDING', 'RETRY', 'LEASED', 'RUNNING')
    `).get() as { avg_age_sec: number | null; max_age_sec: number | null };

    const failureDist = this.db.prepare(`
      SELECT 
        failure_type,
        COUNT(*) as total_failures,
        AVG(attempts) as mean_retries,
        SUM(CASE WHEN status = 'COMPLETE' THEN 1 ELSE 0 END) as recovered,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as permanent
      FROM enrichment_jobs
      WHERE failure_type IS NOT NULL
      GROUP BY failure_type
    `).all() as { failure_type: string; total_failures: number; mean_retries: number; recovered: number; permanent: number }[];

    // Throughput (Rolling 5m, 30m, Overall)
    const getThroughput = (minutes: number | null) => {
      const timeFilter = minutes ? `AND created_at >= datetime('now', '-${minutes} minutes')` : "";
      const completeTimeFilter = minutes ? `AND completed_at >= datetime('now', '-${minutes} minutes')` : "";
      
      const acquired = this.db.prepare(`SELECT COUNT(*) as count FROM enrichment_jobs WHERE 1=1 ${timeFilter}`).get() as { count: number };
      const completed = this.db.prepare(`SELECT COUNT(*) as count FROM enrichment_jobs WHERE status = 'COMPLETE' ${completeTimeFilter}`).get() as { count: number };
      
      // Calculate rates per hour
      let hours = minutes ? minutes / 60 : 1; 
      if (!minutes) {
        // overall
        const firstJob = this.db.prepare(`SELECT created_at FROM enrichment_jobs ORDER BY created_at ASC LIMIT 1`).get() as { created_at: string } | undefined;
        if (firstJob) {
          const diffMs = Date.now() - new Date(firstJob.created_at + 'Z').getTime();
          hours = Math.max(diffMs / (1000 * 60 * 60), 0.016); // min 1 minute
        }
      }

      return {
        acquiredHr: Math.round(acquired.count / hours),
        completedHr: Math.round(completed.count / hours),
        driftHr: Math.round((acquired.count - completed.count) / hours)
      };
    };

    return { 
      counts: stats, 
      age: ageStats,
      failureDistribution: failureDist,
      throughput: {
        last5m: getThroughput(5),
        last30m: getThroughput(30),
        overall: getThroughput(null)
      }
    };
  }

  // 1. Fetch telemetry stats scoped to a specific runId
  public getRunStats(runId: string) {
    const total = this.db.prepare("SELECT COUNT(*) as count FROM enrichment_jobs WHERE run_id = ?").get(runId) as { count: number };
    const completed = this.db.prepare("SELECT COUNT(*) as count FROM enrichment_jobs WHERE run_id = ? AND status = 'COMPLETE'").get(runId) as { count: number };
    const failed = this.db.prepare("SELECT COUNT(*) as count FROM enrichment_jobs WHERE run_id = ? AND status = 'FAILED'").get(runId) as { count: number };
    const processing = this.db.prepare("SELECT COUNT(*) as count FROM enrichment_jobs WHERE run_id = ? AND status IN ('LEASED', 'RUNNING')").get(runId) as { count: number };
    const pending = this.db.prepare("SELECT COUNT(*) as count FROM enrichment_jobs WHERE run_id = ? AND status IN ('PENDING', 'RETRY')").get(runId) as { count: number };
    
    // Fetch latest processed job details to display in the UI console
    const latestJobs = this.db.prepare(`
      SELECT id, snapshot_path, status, last_error
      FROM enrichment_jobs
      WHERE run_id = ?
      ORDER BY completed_at DESC, created_at DESC
      LIMIT 3
    `).all(runId) as any[];

    return {
      total: total.count,
      completed: completed.count,
      failed: failed.count,
      processing: processing.count,
      pending: pending.count,
      latestJobs
    };
  }

  // 2. Fetch full global ingestion and recommendation pipeline stats
  public getGlobalPipelineStats() {
    const counts = this.db.prepare(`
      SELECT status, COUNT(*) as count 
      FROM enrichment_jobs 
      GROUP BY status
    `).all() as { status: string; count: number }[];

    const stateMap: Record<string, number> = {
      PENDING: 0, LEASED: 0, RUNNING: 0, RETRY: 0, COMPLETE: 0, FAILED: 0
    };
    for (const row of counts) {
      stateMap[row.status] = row.count;
    }

    // Oldest Pending Age in seconds
    const oldestPendingRow = this.db.prepare(`
      SELECT CAST(strftime('%s', CURRENT_TIMESTAMP) - strftime('%s', created_at) AS INTEGER) as age_sec
      FROM enrichment_jobs
      WHERE status IN ('PENDING', 'RETRY')
      ORDER BY created_at ASC
      LIMIT 1
    `).get() as { age_sec: number | null } | undefined;

    // Detailed failure reasons distribution
    const failures = this.db.prepare(`
      SELECT failure_type, COUNT(*) as count
      FROM enrichment_jobs
      WHERE status = 'FAILED' OR status = 'RETRY'
      GROUP BY failure_type
    `).all() as { failure_type: string | null; count: number }[];

    const errorDistribution: Record<string, number> = {};
    for (const f of failures) {
      errorDistribution[f.failure_type || "UNKNOWN"] = f.count;
    }

    // Throughput (completions in last 5 minutes)
    const completions5m = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM enrichment_jobs 
      WHERE status = 'COMPLETE' 
        AND completed_at >= datetime('now', '-5 minutes')
    `).get() as { count: number };

    // Total unique cache hits vs live LLM calls
    const cacheHitStats = this.db.prepare(`
      SELECT 
        SUM(CASE WHEN details LIKE '%cached%' OR details LIKE '%skipped LLM%' THEN 1 ELSE 0 END) as cache_saves,
        COUNT(*) as total
      FROM enrichment_events
      WHERE event_type = 'JOB_FINISHED'
    `).get() as { cache_saves: number | null; total: number } | undefined;

    return {
      discovered: stateMap.PENDING + stateMap.RETRY + stateMap.LEASED + stateMap.RUNNING + stateMap.COMPLETE + stateMap.FAILED,
      pending: stateMap.PENDING,
      retry: stateMap.RETRY,
      leased: stateMap.LEASED,
      enriching: stateMap.RUNNING,
      completed: stateMap.COMPLETE,
      failed: stateMap.FAILED,
      oldestPendingSec: oldestPendingRow?.age_sec ?? null,
      throughputPerMin: Number((completions5m.count / 5).toFixed(1)),
      cacheHitRate: cacheHitStats?.total ? Math.round(((cacheHitStats.cache_saves || 0) / cacheHitStats.total) * 100) : 0,
      cacheSaves: cacheHitStats?.cache_saves || 0,
      errorDistribution
    };
  }

  // 3. Count of pending/retry jobs for a specific runId
  public getPendingCountForRun(runId: string): number {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM enrichment_jobs 
      WHERE run_id = ? AND status IN ('PENDING', 'RETRY')
    `);
    const res = stmt.get(runId) as { count: number };
    return res.count;
  }

  // 4. Check if any jobs for a run are in retry status
  public hasRetriesForRun(runId: string): boolean {
    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count 
      FROM enrichment_jobs 
      WHERE run_id = ? AND status = 'RETRY'
    `);
    const res = stmt.get(runId) as { count: number };
    return res.count > 0;
  }

  // 5. Lease jobs for a specific runId
  public leaseJobsForRun(workerId: string, runId: string, limit: number, leaseDurationSeconds: number = 300): EnrichmentJob[] {
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + leaseDurationSeconds * 1000).toISOString();

    const stmt = this.db.prepare(`
      UPDATE enrichment_jobs
      SET status = 'LEASED',
          lease_owner = ?,
          lease_expires_at = ?
      WHERE id IN (
        SELECT id FROM enrichment_jobs
        WHERE run_id = ? AND (
             (status = 'PENDING')
          OR (status = 'RETRY' AND (next_retry_at IS NULL OR next_retry_at <= ?))
          OR (status = 'LEASED' AND lease_expires_at < ?)
        )
        ORDER BY (business_priority + execution_priority) DESC, created_at ASC
        LIMIT ?
      )
      RETURNING *
    `);

    const leased = stmt.all(workerId, expiresAt, runId, now, now, limit) as EnrichmentJob[];
    for (const job of leased) {
      this.logEvent(job.id, "LEASE_ACQUIRED", JSON.stringify({ workerId, expiresAt }));
    }
    return leased;
  }

  // 6. Recover expired leases back to PENDING
  public recoverExpiredLeases(): number {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE enrichment_jobs
      SET status = 'PENDING',
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error = 'Lease expired / worker reclaimed job'
      WHERE status = 'LEASED' AND lease_expires_at < ?
    `);
    const result = stmt.run(now);
    return result.changes;
  }
}

