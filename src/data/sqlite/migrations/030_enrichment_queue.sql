-- Migration 030: Canonical Turso Cloud Operational Queue State Plane
-- Unifies raw card enrichment and extraction queue into Turso Cloud,
-- eliminating local .radar/queue.db and better-sqlite3 filesystem state.

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
    status TEXT NOT NULL DEFAULT 'PENDING',
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
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_run_id ON enrichment_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_priority ON enrichment_jobs(status, (business_priority + execution_priority) DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS enrichment_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id TEXT,
    event_type TEXT,
    details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(job_id) REFERENCES enrichment_jobs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_enrichment_events_job ON enrichment_events(job_id);
