-- Document jobs have their own identity; retain every historical telemetry column and row.
CREATE TABLE model_invocations_090 (
  id TEXT PRIMARY KEY,
  evaluation_job_id TEXT,
  dossier_composition_job_id TEXT,
  review_job_id TEXT,
  pursuit_id TEXT,
  pursuit_preparation_job_id TEXT,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  canonical_job_id TEXT,
  opportunity_version TEXT,
  evaluation_context_fingerprint TEXT,
  pipeline TEXT NOT NULL CHECK(pipeline IN ('evaluation','dossier','factual_review','pursuit','documents')),
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
  error_code TEXT,
  purpose TEXT NOT NULL DEFAULT 'LIVE' CHECK(purpose IN ('LIVE','BENCH')),
  bench_run_id TEXT REFERENCES admin_bench_runs(id),
  taxonomy_shadow_run_id TEXT REFERENCES intelligence_taxonomy_shadows(id),
  document_id TEXT,
  document_job_id TEXT,
  CHECK (
    (pipeline='documents' AND document_id IS NOT NULL AND document_job_id IS NOT NULL
      AND canonical_job_id IS NULL AND opportunity_version IS NULL AND evaluation_context_fingerprint IS NULL
      AND evaluation_job_id IS NULL AND dossier_composition_job_id IS NULL AND review_job_id IS NULL
      AND pursuit_id IS NULL AND pursuit_preparation_job_id IS NULL)
    OR
    (pipeline!='documents' AND document_id IS NULL AND document_job_id IS NULL
      AND canonical_job_id IS NOT NULL AND opportunity_version IS NOT NULL AND evaluation_context_fingerprint IS NOT NULL)
  )
);

INSERT INTO model_invocations_090(
  id,evaluation_job_id,dossier_composition_job_id,review_job_id,
  pursuit_id,pursuit_preparation_job_id,
  tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,
  pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,
  request_fingerprint,max_output_tokens,started_at,completed_at,latency_ms,
  input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,
  finish_reason,status,error_code,purpose,bench_run_id,taxonomy_shadow_run_id
)
SELECT
  id,evaluation_job_id,dossier_composition_job_id,review_job_id,
  pursuit_id,pursuit_preparation_job_id,
  tenant_id,person_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,
  pipeline,stage,attempt,provider,model_id,model_version,model_configuration_fingerprint,
  request_fingerprint,max_output_tokens,started_at,completed_at,latency_ms,
  input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens,
  finish_reason,status,error_code,purpose,bench_run_id,taxonomy_shadow_run_id
FROM model_invocations;

DROP TABLE model_invocations;
ALTER TABLE model_invocations_090 RENAME TO model_invocations;

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

CREATE INDEX idx_model_invocations_document_job ON model_invocations(document_job_id,started_at);
CREATE INDEX idx_model_invocations_document_owner ON model_invocations(tenant_id,person_id,document_id,started_at);

CREATE TABLE provider_incident_jobs_090 (
 incident_id TEXT NOT NULL REFERENCES provider_incidents(id), pipeline TEXT NOT NULL,
 job_id TEXT NOT NULL, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL,
 canonical_job_id TEXT, opportunity_version TEXT, context_fingerprint TEXT,
 accounted_reason TEXT, document_id TEXT, PRIMARY KEY(incident_id,pipeline,job_id),
 CHECK (
   (pipeline='documents' AND document_id IS NOT NULL AND canonical_job_id IS NULL
     AND opportunity_version IS NULL AND context_fingerprint IS NULL)
   OR
   (pipeline IN ('evaluation','dossier','factual_review','pursuit') AND document_id IS NULL
     AND canonical_job_id IS NOT NULL AND opportunity_version IS NOT NULL AND context_fingerprint IS NOT NULL)
 )
);
INSERT INTO provider_incident_jobs_090
 (incident_id,pipeline,job_id,tenant_id,person_id,canonical_job_id,opportunity_version,context_fingerprint,accounted_reason)
 SELECT incident_id,pipeline,job_id,tenant_id,person_id,canonical_job_id,opportunity_version,context_fingerprint,accounted_reason
 FROM provider_incident_jobs;
DROP TABLE provider_incident_jobs;
ALTER TABLE provider_incident_jobs_090 RENAME TO provider_incident_jobs;
