-- Migration 027: Recreate materialized_evaluations with Nullable Decision & Quality Score (Phase 2)
-- Enables 'No evidence -> no decision' contract for SPARSE_SPEC, ACQUISITION_PENDING, and EXPIRED.

CREATE TABLE IF NOT EXISTS materialized_evaluations_v2 (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    person_id TEXT NOT NULL REFERENCES people(id),
    canonical_job_id TEXT NOT NULL,
    opportunity_version TEXT NOT NULL,
    evaluation_context_fingerprint TEXT NOT NULL REFERENCES evaluation_contexts(context_fingerprint),
    evaluation_state TEXT NOT NULL DEFAULT 'UNKNOWN',
    decision TEXT CHECK(decision IS NULL OR decision IN ('PURSUE', 'CONSIDER', 'PASS', 'SPARSE_SPEC')),
    quality_score REAL,
    rationale TEXT,
    evidence_ids TEXT,
    evaluation_json TEXT NOT NULL,
    materialized_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
);

INSERT OR IGNORE INTO materialized_evaluations_v2 (
    id, tenant_id, person_id, canonical_job_id, opportunity_version,
    evaluation_context_fingerprint, evaluation_state, decision,
    quality_score, rationale, evidence_ids, evaluation_json, materialized_at
)
SELECT 
    id, tenant_id, person_id, canonical_job_id, opportunity_version,
    evaluation_context_fingerprint, evaluation_state, decision,
    quality_score, rationale, evidence_ids, evaluation_json, materialized_at
FROM materialized_evaluations;

DROP TABLE materialized_evaluations;

ALTER TABLE materialized_evaluations_v2 RENAME TO materialized_evaluations;

CREATE INDEX IF NOT EXISTS idx_materialized_eval_state
    ON materialized_evaluations(tenant_id, person_id, evaluation_state);

CREATE INDEX IF NOT EXISTS idx_mat_eval_tenant_person
    ON materialized_evaluations(tenant_id, person_id);

CREATE INDEX IF NOT EXISTS idx_mat_eval_opp_ver
    ON materialized_evaluations(canonical_job_id, opportunity_version);
