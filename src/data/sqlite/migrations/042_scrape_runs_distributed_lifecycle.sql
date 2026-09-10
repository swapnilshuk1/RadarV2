-- Migration 042: Distributed Lifecycle, Version-Aware Enrichment, and Decoupled Evaluation Requirements
-- Gate 3: Distributed Execution & Evaluation Queue Decoupling

-- 1. Table Recreation: scrape_runs with expanded status CHECK constraint
CREATE TABLE IF NOT EXISTS scrape_runs_new (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,
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

-- 2. Version-Aware Enrichment Identity on enrichment_jobs
ALTER TABLE enrichment_jobs ADD COLUMN canonical_job_id TEXT;
ALTER TABLE enrichment_jobs ADD COLUMN opportunity_version TEXT;

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_canonical_ver 
ON enrichment_jobs(canonical_job_id, opportunity_version, pipeline_version);

-- 3. Shared Evaluation Requirements (Durable Truth)
CREATE TABLE IF NOT EXISTS evaluation_requirements (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,
    canonical_job_id TEXT NOT NULL,
    opportunity_version TEXT NOT NULL,
    evaluation_context_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('WAITING_ENRICHMENT', 'READY', 'SATISFIED', 'FAILED')),
    ready_at TIMESTAMP,
    satisfied_at TIMESTAMP,
    blocked_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (person_id, tenant_id) REFERENCES people(id, tenant_id),
    FOREIGN KEY (search_plan_id, tenant_id, person_id) REFERENCES search_plans(id, tenant_id, person_id) ON DELETE CASCADE,
    FOREIGN KEY (canonical_job_id, opportunity_version) REFERENCES opportunity_versions(canonical_job_id, id),
    UNIQUE(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_eval_req_status ON evaluation_requirements(status);
CREATE INDEX IF NOT EXISTS idx_eval_req_canonical_ver ON evaluation_requirements(canonical_job_id, opportunity_version);

-- 4. Scrape Run to Evaluation Requirements Association (Run Binding)
CREATE TABLE IF NOT EXISTS scrape_run_evaluation_requirements (
    run_id TEXT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
    evaluation_requirement_id TEXT NOT NULL REFERENCES evaluation_requirements(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, evaluation_requirement_id)
);

CREATE INDEX IF NOT EXISTS idx_srer_run_id ON scrape_run_evaluation_requirements(run_id);
CREATE INDEX IF NOT EXISTS idx_srer_req_id ON scrape_run_evaluation_requirements(evaluation_requirement_id);

-- 5. Scrape Run to Enrichment Requirements Association (Run Binding)
CREATE TABLE IF NOT EXISTS scrape_run_enrichment_requirements (
    run_id TEXT NOT NULL REFERENCES scrape_runs(id) ON DELETE CASCADE,
    enrichment_job_id TEXT NOT NULL REFERENCES enrichment_jobs(id) ON DELETE CASCADE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, enrichment_job_id)
);

CREATE INDEX IF NOT EXISTS idx_srenr_run_id ON scrape_run_enrichment_requirements(run_id);
CREATE INDEX IF NOT EXISTS idx_srenr_job_id ON scrape_run_enrichment_requirements(enrichment_job_id);

-- 6. Backfill existing enrichment_jobs into scrape_run_enrichment_requirements
INSERT OR IGNORE INTO scrape_run_enrichment_requirements (run_id, enrichment_job_id)
SELECT run_id, id FROM enrichment_jobs WHERE run_id IS NOT NULL;

-- 7. Backfill existing evaluation_jobs into evaluation_requirements
INSERT OR IGNORE INTO evaluation_requirements (
    id, tenant_id, person_id, search_plan_id, canonical_job_id,
    opportunity_version, evaluation_context_fingerprint,
    status, ready_at, satisfied_at, created_at
)
SELECT 
    'er_' || ej.id,
    ej.tenant_id,
    ej.person_id,
    ej.search_plan_id,
    ej.canonical_job_id,
    ej.opportunity_version,
    ej.evaluation_context_fingerprint,
    CASE 
        WHEN me.id IS NOT NULL THEN 'SATISFIED'
        WHEN ej.status = 'completed' THEN 'SATISFIED'
        WHEN ej.status = 'dead_letter' THEN 'FAILED'
        WHEN doc.id IS NOT NULL THEN 'READY'
        ELSE 'WAITING_ENRICHMENT'
    END,
    CASE WHEN doc.id IS NOT NULL OR me.id IS NOT NULL THEN CURRENT_TIMESTAMP ELSE NULL END,
    CASE WHEN me.id IS NOT NULL OR ej.status = 'completed' THEN CURRENT_TIMESTAMP ELSE NULL END,
    ej.created_at
FROM evaluation_jobs ej
LEFT JOIN materialized_evaluations me 
  ON me.tenant_id = ej.tenant_id 
 AND me.person_id = ej.person_id 
 AND me.canonical_job_id = ej.canonical_job_id 
 AND me.opportunity_version = ej.opportunity_version 
 AND me.evaluation_context_fingerprint = ej.evaluation_context_fingerprint
LEFT JOIN documents doc 
  ON (doc.opportunity_id = ej.canonical_job_id OR doc.id = 'doc_' || ej.canonical_job_id || '_extraction')
 AND doc.payload_type = 'DIMENSION_EXTRACTION';

-- 8. Protect Legacy Pending Work: Put unproven pending jobs in waiting_enrichment state
UPDATE evaluation_jobs
SET status = 'waiting_enrichment'
WHERE status = 'pending'
  AND NOT EXISTS (
      SELECT 1 FROM evaluation_requirements er
      WHERE er.tenant_id = evaluation_jobs.tenant_id
        AND er.person_id = evaluation_jobs.person_id
        AND er.search_plan_id = evaluation_jobs.search_plan_id
        AND er.canonical_job_id = evaluation_jobs.canonical_job_id
        AND er.opportunity_version = evaluation_jobs.opportunity_version
        AND er.evaluation_context_fingerprint = evaluation_jobs.evaluation_context_fingerprint
        AND er.status IN ('READY', 'SATISFIED')
  );
