-- 067_pursuit_integration_boundaries.sql
--
-- Pursuit integration boundaries. Schema only; additive; no data rewrites.
--   1. Evidence Ledger is a projection of the canonical profile source binding,
--      not of every historical EvidenceGraph. Superseded claims are retained
--      (theses reference them) but flagged out of the current projection.
--   2. Anchor-CV transformation needs the claim's position inside its source.
--   3. Derivation runs in a durable leased queue, not in a web request.
--   4. Pursuits and strategy versions carry canonical opportunity/evaluation lineage.

ALTER TABLE candidate_claims ADD COLUMN current_projection INTEGER NOT NULL DEFAULT 1;
ALTER TABLE candidate_claims ADD COLUMN profile_version TEXT;
ALTER TABLE candidate_claims ADD COLUMN source_ordinal INTEGER;

CREATE INDEX IF NOT EXISTS idx_candidate_claims_current
  ON candidate_claims(tenant_id, person_id, current_projection);

CREATE TABLE IF NOT EXISTS pursuit_ledger_projection_state (
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  profile_version TEXT,
  binding_fingerprint TEXT NOT NULL,
  claim_count INTEGER NOT NULL DEFAULT 0,
  document_count INTEGER NOT NULL DEFAULT 0,
  projected_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, person_id)
);

ALTER TABLE opportunity_pursuits ADD COLUMN canonical_job_id TEXT;
ALTER TABLE opportunity_pursuits ADD COLUMN opportunity_version TEXT;
ALTER TABLE opportunity_pursuits ADD COLUMN evaluation_context_fingerprint TEXT;
ALTER TABLE opportunity_pursuits ADD COLUMN evaluation_fingerprint TEXT;
ALTER TABLE opportunity_pursuits ADD COLUMN profile_version TEXT;

ALTER TABLE pursuit_theses ADD COLUMN canonical_job_id TEXT;
ALTER TABLE pursuit_theses ADD COLUMN opportunity_version TEXT;
ALTER TABLE pursuit_theses ADD COLUMN evaluation_context_fingerprint TEXT;
ALTER TABLE pursuit_theses ADD COLUMN evaluation_fingerprint TEXT;
ALTER TABLE pursuit_theses ADD COLUMN profile_version TEXT;
ALTER TABLE pursuit_theses ADD COLUMN ledger_binding_fingerprint TEXT;
ALTER TABLE pursuit_theses ADD COLUMN anchor_document_id TEXT;

CREATE TABLE IF NOT EXISTS pursuit_preparation_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  pursuit_id TEXT NOT NULL,
  job_hash TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  preferred_archetype_id TEXT,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_by TEXT,
  lease_token TEXT,
  lease_expires_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (pursuit_id) REFERENCES opportunity_pursuits(id) ON DELETE CASCADE
);

-- One live preparation per pursuit: repeated clicks coalesce.
CREATE UNIQUE INDEX IF NOT EXISTS idx_pursuit_preparation_live
  ON pursuit_preparation_jobs(pursuit_id) WHERE status IN ('queued', 'processing');
CREATE INDEX IF NOT EXISTS idx_pursuit_preparation_claimable
  ON pursuit_preparation_jobs(status, lease_expires_at, created_at);

-- Ownership guards matching the Candidate Truth standard (migration 058).
CREATE TRIGGER IF NOT EXISTS candidate_claims_scope_required_insert
BEFORE INSERT ON candidate_claims
WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id AND tenant_id = NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'CANDIDATE_CLAIM_SCOPE_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS candidate_claims_scope_required_update
BEFORE UPDATE OF tenant_id, person_id ON candidate_claims
BEGIN SELECT RAISE(ABORT, 'CANDIDATE_CLAIM_SCOPE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS candidate_archetypes_scope_required_insert
BEFORE INSERT ON candidate_archetypes
WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id AND tenant_id = NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'CANDIDATE_ARCHETYPE_SCOPE_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS candidate_archetypes_scope_required_update
BEFORE UPDATE OF tenant_id, person_id ON candidate_archetypes
BEGIN SELECT RAISE(ABORT, 'CANDIDATE_ARCHETYPE_SCOPE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS opportunity_pursuits_scope_required_insert
BEFORE INSERT ON opportunity_pursuits
WHEN NOT EXISTS (SELECT 1 FROM people WHERE id = NEW.person_id AND tenant_id = NEW.tenant_id)
BEGIN SELECT RAISE(ABORT, 'OPPORTUNITY_PURSUIT_SCOPE_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS opportunity_pursuits_scope_required_update
BEFORE UPDATE OF tenant_id, person_id ON opportunity_pursuits
BEGIN SELECT RAISE(ABORT, 'OPPORTUNITY_PURSUIT_SCOPE_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS pursuit_preparation_jobs_scope_required_insert
BEFORE INSERT ON pursuit_preparation_jobs
WHEN NOT EXISTS (SELECT 1 FROM opportunity_pursuits WHERE id = NEW.pursuit_id AND tenant_id = NEW.tenant_id AND person_id = NEW.person_id)
BEGIN SELECT RAISE(ABORT, 'PURSUIT_PREPARATION_SCOPE_REQUIRED'); END;
