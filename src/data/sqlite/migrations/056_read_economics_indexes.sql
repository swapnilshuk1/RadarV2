-- Hot polling paths must be constrained by tenant/person before aggregating or ordering.
CREATE INDEX IF NOT EXISTS idx_evaluation_jobs_telemetry
  ON evaluation_jobs(tenant_id, person_id, status, completed_at);

CREATE INDEX IF NOT EXISTS idx_model_invocations_telemetry
  ON model_invocations(tenant_id, person_id, pipeline, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_created_at
  ON enrichment_jobs(created_at);
