-- Migration 046: Make search_plan_id nullable on scrape_runs for planless scoped execution
-- Preserves all columns, defaults, check constraints, foreign keys, and indexes.

CREATE TABLE IF NOT EXISTS scrape_runs_new (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT,
    status TEXT NOT NULL CHECK (status IN (
        'queued', 'initializing', 'running', 'waiting_for_confirmation',
        'stopping', 'enriching', 'completing', 'aborted', 'completed', 'failed'
    )),
    portal_targets TEXT NOT NULL,
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

INSERT INTO scrape_runs_new (
    id, tenant_id, person_id, search_plan_id, status,
    portal_targets, config_json, metrics_json, total_discovered, total_enqueued,
    error_message, created_at, started_at, finished_at, updated_at
)
SELECT 
    id, tenant_id, person_id, search_plan_id, status,
    portal_targets, config_json, metrics_json, total_discovered, total_enqueued,
    error_message, created_at, started_at, finished_at, updated_at
FROM scrape_runs;

DROP TABLE scrape_runs;
ALTER TABLE scrape_runs_new RENAME TO scrape_runs;

CREATE INDEX IF NOT EXISTS idx_scrape_runs_tenant_person 
ON scrape_runs(tenant_id, person_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_scrape_runs_status 
ON scrape_runs(status);

DROP INDEX IF EXISTS idx_scrape_runs_active_scope;
CREATE UNIQUE INDEX IF NOT EXISTS idx_scrape_runs_active_scope 
ON scrape_runs(tenant_id, person_id) 
WHERE status IN ('queued', 'initializing', 'running', 'waiting_for_confirmation', 'stopping', 'enriching', 'completing');
