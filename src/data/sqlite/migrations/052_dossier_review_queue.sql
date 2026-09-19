CREATE TABLE IF NOT EXISTS dossier_review_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, canonical_job_id TEXT NOT NULL,
  opportunity_version TEXT NOT NULL, evaluation_context_fingerprint TEXT NOT NULL,
  profile_version TEXT NOT NULL, evaluation_fingerprint TEXT NOT NULL, recipe TEXT NOT NULL,
  draft_json TEXT NOT NULL, draft_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','processing','retry','completed','needs_attention')),
  withheld INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
  lease_token TEXT, lease_until INTEGER, last_error TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,evaluation_fingerprint,recipe)
);
CREATE INDEX IF NOT EXISTS idx_dossier_review_due ON dossier_review_jobs(status,next_attempt_at);
CREATE TABLE IF NOT EXISTS dossier_review_lane (
  id TEXT PRIMARY KEY, lease_token TEXT, lease_until INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0
);
INSERT INTO dossier_review_lane(id) VALUES('factual-review') ON CONFLICT(id) DO NOTHING;
