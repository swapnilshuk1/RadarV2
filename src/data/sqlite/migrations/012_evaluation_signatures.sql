-- Migration 012: Evaluation Signature & Stage-Granular Persistence Schema

CREATE TABLE IF NOT EXISTS evaluation_signatures (
    id TEXT PRIMARY KEY,
    job_hash TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    evaluation_signature TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS assessment_records (
    id TEXT PRIMARY KEY,
    evaluation_signature TEXT NOT NULL UNIQUE,
    job_hash TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    record_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (evaluation_signature) REFERENCES evaluation_signatures(evaluation_signature) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dossier_views (
    id TEXT PRIMARY KEY,
    evaluation_signature TEXT NOT NULL UNIQUE,
    job_hash TEXT NOT NULL,
    candidate_id TEXT NOT NULL,
    presented_json TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (evaluation_signature) REFERENCES evaluation_signatures(evaluation_signature) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_eval_sig_job_candidate ON evaluation_signatures(job_hash, candidate_id);
CREATE INDEX IF NOT EXISTS idx_eval_sig_hash ON evaluation_signatures(evaluation_signature);
CREATE INDEX IF NOT EXISTS idx_assess_rec_sig ON assessment_records(evaluation_signature);
CREATE INDEX IF NOT EXISTS idx_dossier_views_sig ON dossier_views(evaluation_signature);
