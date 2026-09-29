-- 069_model_invocations_pursuit_pipeline.sql
-- Core migration: widen pipeline while retaining the 055/056 schema and indexes.
-- Pursuit identifiers link each invocation to its preparation run.

PRAGMA foreign_keys = OFF;

CREATE TABLE model_invocations_069 (
  id TEXT PRIMARY KEY,
  evaluation_job_id TEXT,
  dossier_composition_job_id TEXT,
  review_job_id TEXT,
  pursuit_id TEXT,
  pursuit_preparation_job_id TEXT,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  canonical_job_id TEXT NOT NULL,
  opportunity_version TEXT NOT NULL,
  evaluation_context_fingerprint TEXT NOT NULL,
  pipeline TEXT NOT NULL CHECK(pipeline IN ('evaluation','dossier','factual_review','pursuit')),
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

INSERT INTO model_invocations_069(
  id,evaluation_job_id,dossier_composition_job_id,review_job_id,
  pursuit_id,pursuit_preparation_job_id,
  tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,
  pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,
  request_fingerprint,max_output_tokens,started_at,completed_at,latency_ms,
  input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,
  finish_reason,status,error_code
)
SELECT
  id,evaluation_job_id,dossier_composition_job_id,review_job_id,
  NULL,NULL,
  tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,
  pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,
  request_fingerprint,max_output_tokens,started_at,completed_at,latency_ms,
  input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,
  finish_reason,status,error_code
FROM model_invocations;

DROP TABLE model_invocations;
ALTER TABLE model_invocations_069 RENAME TO model_invocations;

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
CREATE INDEX idx_model_invocations_telemetry
  ON model_invocations(tenant_id, person_id, pipeline, started_at DESC);

CREATE INDEX idx_model_invocations_pursuit_job
  ON model_invocations(pursuit_preparation_job_id,started_at);

PRAGMA foreign_keys = ON;
