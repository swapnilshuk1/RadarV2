-- Migration 026: Canonical Acquisition Integrity, Orthogonal State & Durable Recovery Queue (Phase 2)

-- 1. Upgrade opportunity_versions with Explicit Provenance (Defaults to UNKNOWN)
ALTER TABLE opportunity_versions ADD COLUMN acquisition_status TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE opportunity_versions ADD COLUMN acquisition_quality TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE opportunity_versions ADD COLUMN failure_class TEXT;
ALTER TABLE opportunity_versions ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE opportunity_versions ADD COLUMN evidence_state TEXT NOT NULL DEFAULT 'UNVERIFIED';

-- 2. Upgrade materialized_evaluations with Dedicated Evaluation State (Defaults to UNKNOWN)
ALTER TABLE materialized_evaluations ADD COLUMN evaluation_state TEXT NOT NULL DEFAULT 'UNKNOWN';

CREATE INDEX IF NOT EXISTS idx_materialized_eval_state
    ON materialized_evaluations(tenant_id, person_id, evaluation_state);

-- 3. Durable Recovery Work Queue
CREATE TABLE IF NOT EXISTS recovery_queue (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    canonical_job_id TEXT NOT NULL REFERENCES canonical_opportunities(id) ON DELETE CASCADE,
    opportunity_version_id TEXT NOT NULL REFERENCES opportunity_versions(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    canonical_url TEXT NOT NULL,
    reason TEXT NOT NULL,
    failure_class TEXT NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL CHECK(status IN ('PENDING', 'PROCESSING', 'RECOVERED', 'EXHAUSTED', 'GENUINELY_SPARSE')),
    next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_attempt_at DATETIME,
    last_error TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);

CREATE INDEX IF NOT EXISTS idx_recovery_queue_status_next
    ON recovery_queue(status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_recovery_queue_opp
    ON recovery_queue(canonical_job_id, opportunity_version_id);

-- Partial Unique Index: Guarantees exactly one active recovery job per version
CREATE UNIQUE INDEX IF NOT EXISTS idx_recovery_queue_active_version
    ON recovery_queue(opportunity_version_id)
    WHERE status IN ('PENDING', 'PROCESSING');
