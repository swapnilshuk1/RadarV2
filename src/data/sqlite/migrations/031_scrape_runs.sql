-- 031_scrape_runs.sql
-- RADAR v2 — Phase 4A: Durable, Tenant-Scoped Scrape Runs & Events Schema
-- Enforces database-level active run uniqueness per (tenant_id, person_id) scope.

CREATE TABLE IF NOT EXISTS scrape_runs (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'queued', 'initializing', 'running', 'waiting_for_confirmation',
        'stopping', 'aborted', 'completed', 'failed'
    )),
    portal_targets TEXT NOT NULL, -- JSON array: ["LinkedIn", "Naukri", "Indeed"]
    config_json TEXT NOT NULL DEFAULT '{}',
    metrics_json TEXT NOT NULL DEFAULT '{}',
    total_discovered INTEGER NOT NULL DEFAULT 0,
    total_enqueued INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (person_id) REFERENCES people(id),
    FOREIGN KEY (search_plan_id) REFERENCES search_plans(id)
);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_tenant_person 
ON scrape_runs(tenant_id, person_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_status 
ON scrape_runs(status);

-- Database-enforced atomic uniqueness: AT MOST ONE active run per (tenant_id, person_id) scope.
-- Any concurrent race to create a second active run for the same scope fails with a UNIQUE constraint error.
CREATE UNIQUE INDEX IF NOT EXISTS idx_scrape_runs_active_scope 
ON scrape_runs(tenant_id, person_id) 
WHERE status IN ('queued', 'initializing', 'running', 'waiting_for_confirmation');

-- Append-only audit and progress event stream for UI observation
CREATE TABLE IF NOT EXISTS scrape_run_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    portal TEXT,
    event_type TEXT NOT NULL, -- 'DISCOVERY', 'ENQUEUE', 'RATE_LIMIT', 'ERROR', 'WARN', 'INFO'
    payload_json TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (run_id) REFERENCES scrape_runs(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_scrape_run_events_run_id 
ON scrape_run_events(run_id, id ASC);
