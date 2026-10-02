CREATE TABLE intelligence_taxonomy_shadows (
 id TEXT PRIMARY KEY, revision_id TEXT NOT NULL REFERENCES taxonomy_revisions(id),active_revision_id TEXT NOT NULL REFERENCES taxonomy_revisions(id),config_revision_id TEXT NOT NULL REFERENCES config_revisions(id),cohort_hash TEXT NOT NULL,scope_json TEXT NOT NULL,environment_json TEXT NOT NULL,worker_environment_json TEXT,
 created_by TEXT NOT NULL REFERENCES users(id),created_at INTEGER NOT NULL,completed_at INTEGER,
 status TEXT NOT NULL CHECK(status IN ('queued','running','passed','failed')),token_cap INTEGER NOT NULL CHECK(token_cap>0),tokens_reserved INTEGER NOT NULL DEFAULT 0 CHECK(tokens_reserved>=0),lease_token TEXT,lease_until INTEGER,result_json TEXT,error TEXT
);
CREATE TRIGGER intelligence_shadow_terminal_update BEFORE UPDATE ON intelligence_taxonomy_shadows WHEN OLD.status IN ('passed','failed') BEGIN SELECT RAISE(ABORT,'INTELLIGENCE_SHADOW_IMMUTABLE'); END;
CREATE TRIGGER intelligence_shadow_delete BEFORE DELETE ON intelligence_taxonomy_shadows BEGIN SELECT RAISE(ABORT,'INTELLIGENCE_SHADOW_IMMUTABLE'); END;
CREATE TRIGGER intelligence_shadow_identity BEFORE UPDATE ON intelligence_taxonomy_shadows WHEN NEW.revision_id IS NOT OLD.revision_id OR NEW.active_revision_id IS NOT OLD.active_revision_id OR NEW.config_revision_id IS NOT OLD.config_revision_id OR NEW.cohort_hash IS NOT OLD.cohort_hash OR NEW.scope_json IS NOT OLD.scope_json OR NEW.environment_json IS NOT OLD.environment_json OR NEW.created_by IS NOT OLD.created_by OR NEW.token_cap IS NOT OLD.token_cap BEGIN SELECT RAISE(ABORT,'INTELLIGENCE_SHADOW_IDENTITY_IMMUTABLE'); END;
ALTER TABLE model_invocations ADD COLUMN taxonomy_shadow_run_id TEXT REFERENCES intelligence_taxonomy_shadows(id);
