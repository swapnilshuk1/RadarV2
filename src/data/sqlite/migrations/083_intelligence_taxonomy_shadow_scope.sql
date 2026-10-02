ALTER TABLE intelligence_taxonomy_shadows
  ADD COLUMN scope_kind TEXT NOT NULL DEFAULT 'legacy'
  CHECK(scope_kind IN ('golden','tenant_sample','legacy'));
CREATE INDEX idx_intelligence_shadow_scope
  ON intelligence_taxonomy_shadows(revision_id, active_revision_id, scope_kind, status, created_at);
CREATE UNIQUE INDEX intelligence_shadow_live_scope
  ON intelligence_taxonomy_shadows(revision_id, active_revision_id, scope_kind)
  WHERE status IN ('queued','running');
