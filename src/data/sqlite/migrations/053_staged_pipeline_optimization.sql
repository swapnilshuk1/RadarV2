-- 053_staged_pipeline_optimization.sql
-- Pre-production end-state: independent durable evaluation, dossier composition and review stages,
-- exact per-invocation model telemetry, and configuration-bound semantic checkpoints.

ALTER TABLE evaluation_jobs ADD COLUMN first_claimed_at DATETIME;
ALTER TABLE evaluation_jobs ADD COLUMN evaluation_persisted_at DATETIME;
ALTER TABLE evaluation_jobs ADD COLUMN dossier_queued_at DATETIME;

ALTER TABLE staged_evaluations
  ADD COLUMN model_configuration_fingerprint TEXT NOT NULL DEFAULT 'legacy';

-- Configuration changes are semantic generation identity. Rebuild the source cache
-- so two configurations of the same provider/model can coexist safely.
ALTER TABLE staged_source_evidence_cache RENAME TO staged_source_evidence_cache_legacy_053;
CREATE TABLE staged_source_evidence_cache (
  source_fingerprint TEXT NOT NULL,
  extraction_contract_version TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  model_configuration_fingerprint TEXT NOT NULL,
  source_json TEXT NOT NULL,
  claims_json TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (
    source_fingerprint,
    extraction_contract_version,
    model_id,
    model_version,
    model_configuration_fingerprint
  )
);
INSERT INTO staged_source_evidence_cache(
  source_fingerprint,extraction_contract_version,model_id,model_version,
  model_configuration_fingerprint,source_json,claims_json,created_at
)
SELECT source_fingerprint,extraction_contract_version,model_id,model_version,
       'legacy',source_json,claims_json,created_at
FROM staged_source_evidence_cache_legacy_053;
DROP TABLE staged_source_evidence_cache_legacy_053;

CREATE TABLE staged_model_checkpoints (
  scope_fingerprint TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  stage TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  model_configuration_fingerprint TEXT NOT NULL,
  response_json TEXT NOT NULL,
  response_fingerprint TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY(scope_fingerprint,request_fingerprint)
);
CREATE INDEX idx_staged_model_checkpoint_stage
  ON staged_model_checkpoints(scope_fingerprint,stage);

CREATE TABLE dossier_composition_jobs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  canonical_job_id TEXT NOT NULL,
  opportunity_version TEXT NOT NULL,
  evaluation_context_fingerprint TEXT NOT NULL,
  evaluation_fingerprint TEXT NOT NULL,
  profile_version TEXT NOT NULL,
  recipe TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','processing','retry','completed','needs_attention')),
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at INTEGER NOT NULL,
  lease_token TEXT,
  lease_until INTEGER,
  last_error TEXT,
  draft_persisted_at INTEGER,
  published_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(
    tenant_id,person_id,canonical_job_id,opportunity_version,
    evaluation_context_fingerprint,evaluation_fingerprint,recipe
  )
);
CREATE INDEX idx_dossier_composition_due
  ON dossier_composition_jobs(status,next_attempt_at,created_at);

CREATE TABLE model_invocations (
  id TEXT PRIMARY KEY,
  evaluation_job_id TEXT,
  dossier_composition_job_id TEXT,
  review_job_id TEXT,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  canonical_job_id TEXT NOT NULL,
  opportunity_version TEXT NOT NULL,
  evaluation_context_fingerprint TEXT NOT NULL,
  pipeline TEXT NOT NULL CHECK(pipeline IN ('evaluation','dossier','factual_review')),
  stage TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_version TEXT NOT NULL,
  model_configuration_fingerprint TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  max_output_tokens INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  latency_ms INTEGER,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_tokens INTEGER,
  total_tokens INTEGER,
  finish_reason TEXT,
  status TEXT NOT NULL CHECK(status IN ('completed','provider_error','transport_error','invalid_output')),
  error_code TEXT
);
CREATE INDEX idx_model_invocations_job
  ON model_invocations(evaluation_job_id,dossier_composition_job_id,review_job_id,started_at);
CREATE INDEX idx_model_invocations_scope
  ON model_invocations(
    tenant_id,person_id,canonical_job_id,opportunity_version,
    evaluation_context_fingerprint,pipeline,started_at
  );
