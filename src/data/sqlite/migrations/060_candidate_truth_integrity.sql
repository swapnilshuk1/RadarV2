CREATE UNIQUE INDEX IF NOT EXISTS uq_career_intents_scope_version ON career_intents(tenant_id, person_id, version);
ALTER TABLE candidate_document_jobs ADD COLUMN next_attempt_at DATETIME;
CREATE INDEX IF NOT EXISTS idx_candidate_document_jobs_ready ON candidate_document_jobs(status, next_attempt_at, created_at);
CREATE TABLE user_preferences (user_id TEXT PRIMARY KEY REFERENCES users(id), attention_window INTEGER NOT NULL DEFAULT 6 CHECK(attention_window BETWEEN 1 AND 10), updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);
