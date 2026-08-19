-- Migration 019: Multi-Tenant Evaluation Context & Materialized Read Model (Phase M3)

-- 1. Search Plans table
CREATE TABLE IF NOT EXISTS search_plans (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'paused', 'archived')),
    criteria_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_search_plans_tenant_person
    ON search_plans(tenant_id, person_id);

-- 2. Search Plan Snapshots table (Immutable criteria snapshots)
CREATE TABLE IF NOT EXISTS search_plan_snapshots (
    id TEXT PRIMARY KEY,
    search_plan_id TEXT NOT NULL REFERENCES search_plans(id) ON DELETE CASCADE,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    snapshot_hash TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(search_plan_id, snapshot_hash)
);

CREATE INDEX IF NOT EXISTS idx_search_plan_snapshots_tenant_person
    ON search_plan_snapshots(tenant_id, person_id);

-- 3. Evaluation Contexts table (Immutable evaluation context snapshots)
CREATE TABLE IF NOT EXISTS evaluation_contexts (
    context_fingerprint TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    search_plan_snapshot_id TEXT NOT NULL REFERENCES search_plan_snapshots(id),
    ontology_version TEXT NOT NULL,
    ontology_fingerprint TEXT NOT NULL,
    policy_version TEXT NOT NULL,
    profile_version TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version)
);

CREATE INDEX IF NOT EXISTS idx_eval_contexts_tenant_person
    ON evaluation_contexts(tenant_id, person_id);

-- 4. Materialized Evaluations table (Immutable canonical evaluation read model)
CREATE TABLE IF NOT EXISTS materialized_evaluations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    canonical_job_id TEXT NOT NULL,
    opportunity_version TEXT NOT NULL,
    evaluation_context_fingerprint TEXT NOT NULL REFERENCES evaluation_contexts(context_fingerprint),
    decision TEXT NOT NULL CHECK(decision IN ('PURSUE', 'CONSIDER', 'PASS')),
    quality_score REAL NOT NULL,
    rationale TEXT,
    evidence_ids TEXT NOT NULL,
    evaluation_json TEXT NOT NULL,
    materialized_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(canonical_job_id, opportunity_version, evaluation_context_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_mat_eval_tenant_person_score
    ON materialized_evaluations(tenant_id, person_id, decision, quality_score DESC);

CREATE INDEX IF NOT EXISTS idx_mat_eval_context
    ON materialized_evaluations(evaluation_context_fingerprint);

CREATE INDEX IF NOT EXISTS idx_mat_eval_job
    ON materialized_evaluations(canonical_job_id);
