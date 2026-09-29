-- 068_pursuit_premerge_hardening.sql
--
-- Pursuit pre-merge hardening. Schema only; additive; no data rewrites.
--   1. Retry backoff so a failed preparation does not immediately re-burn
--      provider calls (next_attempt_at).
--   2. Durable stage checkpoints so an operational retry does not repay for
--      model stages that already succeeded.
--   3. Relational scope guards for pursuit child references, matching the
--      spirit of migration 058: server call order is not the trust boundary.

ALTER TABLE pursuit_preparation_jobs ADD COLUMN next_attempt_at TEXT;

CREATE INDEX IF NOT EXISTS idx_pursuit_preparation_next_attempt
  ON pursuit_preparation_jobs(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS pursuit_stage_checkpoints (
  job_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (job_id, stage),
  FOREIGN KEY (job_id) REFERENCES pursuit_preparation_jobs(id) ON DELETE CASCADE
);

-- ---------------------------------------------------------------------------
-- Relational invariants: a pursuit's active archetype/thesis, its artifacts and
-- its learning signals must belong to the same tenant/person/pursuit.
-- ---------------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS pursuit_active_thesis_same_pursuit
BEFORE UPDATE OF active_thesis_id ON opportunity_pursuits
WHEN NEW.active_thesis_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM pursuit_theses t
   WHERE t.id = NEW.active_thesis_id AND t.pursuit_id = NEW.id
 )
BEGIN SELECT RAISE(ABORT, 'PURSUIT_ACTIVE_THESIS_FOREIGN'); END;

CREATE TRIGGER IF NOT EXISTS pursuit_active_archetype_same_scope
BEFORE UPDATE OF active_archetype_id ON opportunity_pursuits
WHEN NEW.active_archetype_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM candidate_archetypes a
   WHERE a.id = NEW.active_archetype_id
     AND a.tenant_id = NEW.tenant_id
     AND a.person_id = NEW.person_id
 )
BEGIN SELECT RAISE(ABORT, 'PURSUIT_ACTIVE_ARCHETYPE_SCOPE'); END;

CREATE TRIGGER IF NOT EXISTS pursuit_artifacts_thesis_same_pursuit
BEFORE INSERT ON pursuit_artifacts
WHEN NEW.thesis_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM pursuit_theses t
   WHERE t.id = NEW.thesis_id AND t.pursuit_id = NEW.pursuit_id
 )
BEGIN SELECT RAISE(ABORT, 'PURSUIT_ARTIFACT_THESIS_FOREIGN'); END;

CREATE TRIGGER IF NOT EXISTS pursuit_theses_pursuit_exists
BEFORE INSERT ON pursuit_theses
WHEN NOT EXISTS (SELECT 1 FROM opportunity_pursuits p WHERE p.id = NEW.pursuit_id)
BEGIN SELECT RAISE(ABORT, 'PURSUIT_THESIS_PURSUIT_MISSING'); END;

CREATE TRIGGER IF NOT EXISTS learning_signals_pursuit_same_scope
BEFORE INSERT ON candidate_learning_signals
WHEN NEW.pursuit_id IS NOT NULL
 AND NOT EXISTS (
   SELECT 1 FROM opportunity_pursuits p
   WHERE p.id = NEW.pursuit_id
     AND p.tenant_id = NEW.tenant_id
     AND p.person_id = NEW.person_id
 )
BEGIN SELECT RAISE(ABORT, 'LEARNING_SIGNAL_PURSUIT_SCOPE'); END;

CREATE TRIGGER IF NOT EXISTS pursuit_active_thesis_same_pursuit_insert
BEFORE INSERT ON opportunity_pursuits
WHEN NEW.active_thesis_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM pursuit_theses t WHERE t.id = NEW.active_thesis_id AND t.pursuit_id = NEW.id
)
BEGIN SELECT RAISE(ABORT, 'PURSUIT_ACTIVE_THESIS_FOREIGN'); END;

CREATE TRIGGER IF NOT EXISTS pursuit_active_archetype_same_scope_insert
BEFORE INSERT ON opportunity_pursuits
WHEN NEW.active_archetype_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM candidate_archetypes a WHERE a.id = NEW.active_archetype_id
    AND a.tenant_id = NEW.tenant_id AND a.person_id = NEW.person_id
)
BEGIN SELECT RAISE(ABORT, 'PURSUIT_ACTIVE_ARCHETYPE_SCOPE'); END;

CREATE TRIGGER IF NOT EXISTS pursuit_artifacts_thesis_same_pursuit_update
BEFORE UPDATE OF thesis_id,pursuit_id ON pursuit_artifacts
WHEN NEW.thesis_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM pursuit_theses t WHERE t.id = NEW.thesis_id AND t.pursuit_id = NEW.pursuit_id
)
BEGIN SELECT RAISE(ABORT, 'PURSUIT_ARTIFACT_THESIS_FOREIGN'); END;

CREATE TRIGGER IF NOT EXISTS learning_signals_pursuit_same_scope_update
BEFORE UPDATE OF pursuit_id,tenant_id,person_id ON candidate_learning_signals
WHEN NEW.pursuit_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM opportunity_pursuits p WHERE p.id = NEW.pursuit_id
    AND p.tenant_id = NEW.tenant_id AND p.person_id = NEW.person_id
)
BEGIN SELECT RAISE(ABORT, 'LEARNING_SIGNAL_PURSUIT_SCOPE'); END;
