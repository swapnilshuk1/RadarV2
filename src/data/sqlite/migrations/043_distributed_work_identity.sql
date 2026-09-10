-- Migration 043: Distributed Work Identity & Exact Enrichment Dependency
-- Rebuilds enrichment_jobs without global job_hash uniqueness, enforcing:
-- 1. Canonical work identity: UNIQUE(canonical_job_id, opportunity_version, pipeline_version)
-- 2. Legacy unbound work identity: UNIQUE(job_hash, pipeline_version) WHERE canonical_job_id IS NULL
-- 3. Exact enrichment pipeline version dependency on evaluation_requirements
-- 4. Fail-closed repair of legacy evaluation requirements backfill

-- Recreate enrichment_jobs with mutually exclusive canonical vs legacy work constraints
CREATE TABLE IF NOT EXISTS enrichment_jobs_new (
    id TEXT PRIMARY KEY,
    job_hash TEXT NOT NULL,
    pipeline_version TEXT NOT NULL,
    snapshot_path TEXT,
    payload_key TEXT,
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
    lease_expires_at DATETIME,
    canonical_job_id TEXT,
    opportunity_version TEXT,
    CHECK (
      (canonical_job_id IS NULL AND opportunity_version IS NULL) OR
      (canonical_job_id IS NOT NULL AND opportunity_version IS NOT NULL)
    )
);

INSERT INTO enrichment_jobs_new (
    id, job_hash, pipeline_version, snapshot_path, payload_key,
    run_id, execution_plan_id, definition_id, family_id, portal, page,
    catalog_version, planner_version, rule_version, search_query,
    status, business_priority, execution_priority, attempts, created_at,
    started_at, completed_at, last_error, failure_type, next_retry_at,
    lease_owner, lease_expires_at, canonical_job_id, opportunity_version
)
SELECT 
    id, job_hash, pipeline_version, snapshot_path, payload_key,
    run_id, execution_plan_id, definition_id, family_id, portal, page,
    catalog_version, planner_version, rule_version, search_query,
    status, business_priority, execution_priority, attempts, created_at,
    started_at, completed_at, last_error, failure_type, next_retry_at,
    lease_owner, lease_expires_at, canonical_job_id, opportunity_version
FROM enrichment_jobs;

DROP TABLE enrichment_jobs;
ALTER TABLE enrichment_jobs_new RENAME TO enrichment_jobs;

-- Mutually exclusive unique indices
CREATE UNIQUE INDEX IF NOT EXISTS idx_enrichment_canonical_work ON enrichment_jobs(
    canonical_job_id, opportunity_version, pipeline_version
) WHERE canonical_job_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_enrichment_legacy_work ON enrichment_jobs(
    job_hash, pipeline_version
) WHERE canonical_job_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_status ON enrichment_jobs(status, next_retry_at);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_run_id ON enrichment_jobs(run_id);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_priority ON enrichment_jobs(status, (business_priority + execution_priority) DESC, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_job_hash ON enrichment_jobs(job_hash);

-- Backfill legacy canonical identity on enrichment_jobs from lineage where available
UPDATE enrichment_jobs
SET 
  canonical_job_id = (
    SELECT ail.canonical_job_id 
    FROM acquisition_ingestion_lineage ail 
    WHERE ail.scrape_run_id = enrichment_jobs.run_id 
      AND (ail.card_id = enrichment_jobs.id OR ail.source_job_id = enrichment_jobs.job_hash)
      AND ail.canonical_job_id IS NOT NULL
    LIMIT 1
  ),
  opportunity_version = (
    SELECT ail.opportunity_version 
    FROM acquisition_ingestion_lineage ail 
    WHERE ail.scrape_run_id = enrichment_jobs.run_id 
      AND (ail.card_id = enrichment_jobs.id OR ail.source_job_id = enrichment_jobs.job_hash)
      AND ail.opportunity_version IS NOT NULL
    LIMIT 1
  )
WHERE canonical_job_id IS NULL
  AND EXISTS (
    SELECT 1 FROM acquisition_ingestion_lineage ail 
    WHERE ail.scrape_run_id = enrichment_jobs.run_id 
      AND (ail.card_id = enrichment_jobs.id OR ail.source_job_id = enrichment_jobs.job_hash)
      AND ail.canonical_job_id IS NOT NULL
      AND ail.opportunity_version IS NOT NULL
  );

-- Add required_enrichment_pipeline_version to evaluation_requirements
ALTER TABLE evaluation_requirements ADD COLUMN required_enrichment_pipeline_version TEXT NOT NULL DEFAULT '1.0.0';

CREATE INDEX IF NOT EXISTS idx_evaluation_requirements_enrich_dep 
ON evaluation_requirements(canonical_job_id, opportunity_version, required_enrichment_pipeline_version, status);

-- Fail-closed repair of legacy evaluation requirements:
-- 1. Exact materialized evaluation exists -> SATISFIED
UPDATE evaluation_requirements
SET status = 'SATISFIED', satisfied_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT er.id FROM evaluation_requirements er
  JOIN materialized_evaluations me
    ON er.tenant_id = me.tenant_id
   AND er.person_id = me.person_id
   AND er.canonical_job_id = me.canonical_job_id
   AND er.opportunity_version = me.opportunity_version
   AND er.evaluation_context_fingerprint = me.evaluation_context_fingerprint
);

-- 2. Exact canonical/version/pipeline enrichment COMPLETE exists -> READY
UPDATE evaluation_requirements
SET status = 'READY', ready_at = CURRENT_TIMESTAMP
WHERE status = 'WAITING_ENRICHMENT' AND id IN (
  SELECT er.id FROM evaluation_requirements er
  JOIN enrichment_jobs ej
    ON er.canonical_job_id = ej.canonical_job_id
   AND er.opportunity_version = ej.opportunity_version
   AND er.required_enrichment_pipeline_version = ej.pipeline_version
  WHERE ej.status = 'COMPLETE'
);

-- 3. Unproven legacy work -> fail-closed to WAITING_ENRICHMENT
UPDATE evaluation_requirements
SET status = 'WAITING_ENRICHMENT', ready_at = NULL
WHERE status NOT IN ('SATISFIED', 'FAILED') AND id NOT IN (
  SELECT er.id FROM evaluation_requirements er
  JOIN enrichment_jobs ej
    ON er.canonical_job_id = ej.canonical_job_id
   AND er.opportunity_version = ej.opportunity_version
   AND er.required_enrichment_pipeline_version = ej.pipeline_version
  WHERE ej.status = 'COMPLETE'
);

-- Synchronize evaluation_jobs to match repaired requirement status
-- 1. WAITING_ENRICHMENT requirement -> set pending jobs to waiting_enrichment
UPDATE evaluation_jobs
SET status = 'waiting_enrichment', updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT ej.id FROM evaluation_jobs ej
  JOIN evaluation_requirements er
    ON ej.tenant_id = er.tenant_id
   AND ej.person_id = er.person_id
   AND ej.search_plan_id = er.search_plan_id
   AND ej.canonical_job_id = er.canonical_job_id
   AND ej.opportunity_version = er.opportunity_version
   AND ej.evaluation_context_fingerprint = er.evaluation_context_fingerprint
  WHERE er.status = 'WAITING_ENRICHMENT' AND ej.status = 'pending'
);

-- 2. READY requirement -> set waiting_enrichment jobs to pending
UPDATE evaluation_jobs
SET status = 'pending', updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT ej.id FROM evaluation_jobs ej
  JOIN evaluation_requirements er
    ON ej.tenant_id = er.tenant_id
   AND ej.person_id = er.person_id
   AND ej.search_plan_id = er.search_plan_id
   AND ej.canonical_job_id = er.canonical_job_id
   AND ej.opportunity_version = er.opportunity_version
   AND ej.evaluation_context_fingerprint = er.evaluation_context_fingerprint
  WHERE er.status = 'READY' AND ej.status = 'waiting_enrichment'
);

-- 3. SATISFIED requirement -> set non-completed jobs to completed
UPDATE evaluation_jobs
SET status = 'completed', updated_at = CURRENT_TIMESTAMP
WHERE id IN (
  SELECT ej.id FROM evaluation_jobs ej
  JOIN evaluation_requirements er
    ON ej.tenant_id = er.tenant_id
   AND ej.person_id = er.person_id
   AND ej.search_plan_id = er.search_plan_id
   AND ej.canonical_job_id = er.canonical_job_id
   AND ej.opportunity_version = er.opportunity_version
   AND ej.evaluation_context_fingerprint = er.evaluation_context_fingerprint
  WHERE er.status = 'SATISFIED' AND ej.status NOT IN ('completed')
);
