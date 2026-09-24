-- Durable localhost-to-Oracle acquisition handoff. The submission identifier is
-- owned by the producer and is deliberately independent of canonical identity.
-- Source bytes are persisted by CanonicalIngestionService through the configured
-- durable BlobStore before this table can acknowledge canonical admission.
CREATE TABLE IF NOT EXISTS acquisition_ingress_submissions (
  submission_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  person_id TEXT NOT NULL REFERENCES people(id),
  search_plan_id TEXT NULL REFERENCES search_plans(id),
  run_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  accepted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  canonical_job_id TEXT NOT NULL,
  opportunity_version TEXT NOT NULL,
  response_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_acquisition_ingress_submissions_scope
  ON acquisition_ingress_submissions(tenant_id, person_id, run_id, accepted_at);
