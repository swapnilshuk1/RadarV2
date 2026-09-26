CREATE UNIQUE INDEX IF NOT EXISTS uq_career_intents_scope_version ON career_intents(tenant_id, person_id, version);
ALTER TABLE candidate_document_jobs ADD COLUMN next_attempt_at DATETIME;
CREATE INDEX IF NOT EXISTS idx_candidate_document_jobs_ready ON candidate_document_jobs(status, next_attempt_at, created_at);
