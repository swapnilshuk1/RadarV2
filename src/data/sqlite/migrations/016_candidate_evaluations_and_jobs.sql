-- Migration 016: Materialized Candidate Evaluations and Durable Evaluation Job Queue (RADAR Phase C)

CREATE TABLE IF NOT EXISTS candidate_evaluations (
  person_id              TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  job_hash               TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  policy_version         TEXT NOT NULL,
  evaluation_input_hash  TEXT NOT NULL,
  engine_verdict         TEXT NOT NULL CHECK(engine_verdict IN ('PURSUE', 'CONSIDER', 'PASS')),
  engine_quality_score   REAL NOT NULL,
  user_decision_override TEXT CHECK(user_decision_override IN ('PURSUE', 'CONSIDER', 'PASS')),
  effective_decision     TEXT NOT NULL CHECK(effective_decision IN ('PURSUE', 'CONSIDER', 'PASS')),
  quality_score          REAL NOT NULL,
  evaluation_status      TEXT NOT NULL DEFAULT 'COMPLETE' CHECK(evaluation_status IN ('COMPLETE', 'SPARSE_SPEC', 'DEFERRED', 'FAILED')),
  evaluation_json        TEXT NOT NULL,
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (person_id, job_hash)
);

CREATE INDEX IF NOT EXISTS idx_cand_eval_person_quality
  ON candidate_evaluations (person_id, quality_score DESC);

CREATE INDEX IF NOT EXISTS idx_cand_eval_person_job
  ON candidate_evaluations (person_id, job_hash);

CREATE INDEX IF NOT EXISTS idx_cand_eval_person_verdict_quality
  ON candidate_evaluations (person_id, effective_decision, quality_score DESC);

-- Durable DB-Backed Evaluation Job Queue with Lease Recovery
CREATE TABLE IF NOT EXISTS evaluation_jobs (
  id           TEXT PRIMARY KEY,
  person_id    TEXT NOT NULL,
  job_hash     TEXT NOT NULL,
  input_hash   TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SUPERSEDED')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  lock_owner   TEXT,
  locked_at    TEXT,
  available_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(person_id, job_hash, input_hash)
);

CREATE INDEX IF NOT EXISTS idx_eval_jobs_status_available
  ON evaluation_jobs (status, available_at);
