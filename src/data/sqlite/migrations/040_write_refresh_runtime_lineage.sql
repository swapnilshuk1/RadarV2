-- Gate 4: durable document processing and explicit compensation provenance.
-- Existing protected documents/identity rows remain untouched.

ALTER TABLE career_intents ADD COLUMN currency TEXT;
ALTER TABLE career_intents ADD COLUMN target_salary_amount REAL;
ALTER TABLE career_intents ADD COLUMN normalized_salary_usd REAL;
ALTER TABLE career_intents ADD COLUMN normalization_source_currency TEXT;
ALTER TABLE career_intents ADD COLUMN normalization_target_currency TEXT;
ALTER TABLE career_intents ADD COLUMN normalization_rate REAL;
ALTER TABLE career_intents ADD COLUMN normalization_rate_source TEXT;
ALTER TABLE career_intents ADD COLUMN normalization_effective_at TEXT;

CREATE TABLE IF NOT EXISTS candidate_document_jobs (
  id TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  document_id TEXT NOT NULL REFERENCES candidate_documents(id),
  job_hash TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  locked_by TEXT,
  lease_token TEXT,
  locked_at TEXT,
  last_error TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_candidate_document_jobs_claim
  ON candidate_document_jobs(status, locked_at, created_at);
