-- Additive input snapshots for context-aware evaluation. Historical v6 rows are untouched.
CREATE TABLE IF NOT EXISTS staged_frozen_inputs (
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  canonical_job_id TEXT NOT NULL,
  opportunity_version TEXT NOT NULL,
  evaluation_context_fingerprint TEXT NOT NULL,
  source_binding_fingerprint TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  input_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
);
