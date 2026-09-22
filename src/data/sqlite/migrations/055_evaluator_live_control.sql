-- 055_evaluator_live_control.sql
-- Durable evaluator runtime control plus live model invocation rows.

ALTER TABLE model_invocations RENAME TO model_invocations_legacy_055;

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
  status TEXT NOT NULL CHECK(status IN ('running','completed','provider_error','transport_error','invalid_output')),
  error_code TEXT
);

INSERT INTO model_invocations(
  id,evaluation_job_id,dossier_composition_job_id,review_job_id,
  tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,
  pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,
  request_fingerprint,max_output_tokens,started_at,completed_at,latency_ms,
  input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,
  finish_reason,status,error_code
)
SELECT
  id,evaluation_job_id,dossier_composition_job_id,review_job_id,
  tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,
  pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,
  request_fingerprint,max_output_tokens,started_at,completed_at,latency_ms,
  input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,
  finish_reason,status,error_code
FROM model_invocations_legacy_055;

DROP TABLE model_invocations_legacy_055;

CREATE INDEX idx_model_invocations_job
  ON model_invocations(evaluation_job_id,dossier_composition_job_id,review_job_id,started_at);
CREATE INDEX idx_model_invocations_scope
  ON model_invocations(
    tenant_id,person_id,canonical_job_id,opportunity_version,
    evaluation_context_fingerprint,pipeline,started_at
  );
CREATE INDEX idx_model_invocations_pipeline_stage_time
  ON model_invocations(pipeline,stage,started_at);
CREATE INDEX idx_model_invocations_live
  ON model_invocations(status,pipeline,started_at);

CREATE TABLE evaluation_runtime_control (
  id TEXT PRIMARY KEY CHECK(id='global'),
  desired_state TEXT NOT NULL CHECK(desired_state IN ('RUNNING','PAUSED','STOPPED')),
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

INSERT INTO evaluation_runtime_control(id,desired_state,updated_at,updated_by)
VALUES('global','RUNNING',CAST(strftime('%s','now') AS INTEGER)*1000,'migration-055');
