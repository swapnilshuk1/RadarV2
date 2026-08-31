-- 028_active_evaluation_context_pointers.sql
-- V7 Contract-Correct Remediation
-- Establishes immutable scope-binding table and mutable active pointer table.

-- 1. Create immutable scope-binding table to preserve historical context purity
CREATE TABLE evaluation_context_scopes (
    context_fingerprint TEXT NOT NULL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(context_fingerprint, tenant_id, person_id, search_plan_id)
);

-- 2. Create the mutable active pointer table for read-routing
CREATE TABLE active_evaluation_contexts (
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    search_plan_id TEXT NOT NULL,
    context_fingerprint TEXT NOT NULL,
    activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    activated_by TEXT NOT NULL,
    PRIMARY KEY (tenant_id, person_id, search_plan_id),
    FOREIGN KEY (context_fingerprint, tenant_id, person_id, search_plan_id) 
        REFERENCES evaluation_context_scopes(context_fingerprint, tenant_id, person_id, search_plan_id)
);

-- 3. Add Lineage Validation Triggers on Scopes to mathematical prohibit cross-tenant/forged boundaries
CREATE TRIGGER IF NOT EXISTS validate_evaluation_context_scope_insert
BEFORE INSERT ON evaluation_context_scopes
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Context scope lineage mismatch')
    WHERE NOT EXISTS (
        SELECT 1
        FROM evaluation_contexts ec
        JOIN search_plan_snapshots sps ON ec.search_plan_snapshot_id = sps.id
        WHERE ec.context_fingerprint = NEW.context_fingerprint
          AND ec.tenant_id = NEW.tenant_id
          AND ec.person_id = NEW.person_id
          AND sps.search_plan_id = NEW.search_plan_id
    );
END;

CREATE TRIGGER IF NOT EXISTS validate_evaluation_context_scope_update
BEFORE UPDATE ON evaluation_context_scopes
FOR EACH ROW
BEGIN
    SELECT RAISE(ABORT, 'Context scope lineage mismatch')
    WHERE NOT EXISTS (
        SELECT 1
        FROM evaluation_contexts ec
        JOIN search_plan_snapshots sps ON ec.search_plan_snapshot_id = sps.id
        WHERE ec.context_fingerprint = NEW.context_fingerprint
          AND ec.tenant_id = NEW.tenant_id
          AND ec.person_id = NEW.person_id
          AND sps.search_plan_id = NEW.search_plan_id
    );
END;
