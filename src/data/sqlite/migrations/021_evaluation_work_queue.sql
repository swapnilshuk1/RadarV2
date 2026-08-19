-- Migration 021: Distributed Worker Runtime & Durable Evaluation Work Queue
-- Sub-Phase M5.1 — Queue Schema & Hardened Lineage Invariants

-- Drop legacy un-multitenanted V3 prototype queue table if present
DROP TABLE IF EXISTS evaluation_jobs;

CREATE TABLE evaluation_jobs (
    id TEXT PRIMARY KEY,

    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,

    canonical_job_id TEXT NOT NULL,
    opportunity_version TEXT NOT NULL,
    evaluation_context_fingerprint TEXT NOT NULL,

    status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, completed, failed, dead_letter

    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 3,

    next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    last_error TEXT,

    locked_by TEXT,
    lease_token TEXT,
    locked_at DATETIME,

    completed_at DATETIME,

    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- 1. Composite Tenant/Person Lineage Invariant
    FOREIGN KEY (person_id, tenant_id)
        REFERENCES people(id, tenant_id),

    -- 2. Composite Tenant/Person/SearchPlan Lineage Invariant
    FOREIGN KEY (search_plan_id, tenant_id, person_id)
        REFERENCES search_plans(id, tenant_id, person_id)
        ON DELETE CASCADE,

    -- 3. Composite Canonical Job/Version Lineage Invariant
    FOREIGN KEY (canonical_job_id, opportunity_version)
        REFERENCES opportunity_versions(canonical_job_id, id),

    -- 4. Composite Candidate Provenance Invariant: Every EvaluationJob MUST correspond to an existing SearchPlanCandidate
    FOREIGN KEY (
        tenant_id,
        person_id,
        search_plan_id,
        canonical_job_id,
        opportunity_version
    )
        REFERENCES search_plan_candidates(
            tenant_id,
            person_id,
            search_plan_id,
            canonical_job_id,
            opportunity_version
        ),

    -- Context Deduplication Invariant
    CONSTRAINT unq_eval_job_context UNIQUE (
        tenant_id,
        search_plan_id,
        canonical_job_id,
        opportunity_version,
        evaluation_context_fingerprint
    )
);

CREATE INDEX IF NOT EXISTS idx_eval_jobs_status_next_attempt 
    ON evaluation_jobs(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_eval_jobs_claim_lease 
    ON evaluation_jobs(status, locked_at);
