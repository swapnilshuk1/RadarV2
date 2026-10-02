ALTER TABLE taxonomy_revisions ADD COLUMN requires_shadow INTEGER NOT NULL DEFAULT 0;
CREATE TABLE taxonomy_shadow_runs (
  id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES taxonomy_revisions(id),
  active_revision_id TEXT NOT NULL REFERENCES taxonomy_revisions(id),
  status TEXT NOT NULL CHECK(status IN ('passed','failed')),
  result_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);
CREATE INDEX taxonomy_shadow_runs_revision ON taxonomy_shadow_runs(revision_id,created_at DESC);
