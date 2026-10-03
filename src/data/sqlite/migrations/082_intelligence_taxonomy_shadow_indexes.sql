CREATE INDEX idx_intelligence_shadow_claim
  ON intelligence_taxonomy_shadows(status, created_at, id);
CREATE INDEX idx_intelligence_shadow_publish
  ON intelligence_taxonomy_shadows(revision_id, active_revision_id, status, created_at);
CREATE INDEX idx_model_invocation_taxonomy_shadow
  ON model_invocations(taxonomy_shadow_run_id, status, error_code);
