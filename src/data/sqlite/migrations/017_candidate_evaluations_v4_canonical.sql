-- Migration 017: Canonical Evaluation Fingerprinting and Queue Optimization Indexes (RADAR Phase 4C)

-- Index for fast evaluation lookup by candidate identity and canonical input fingerprint
CREATE INDEX IF NOT EXISTS idx_candidate_evaluations_input_hash
  ON candidate_evaluations (person_id, evaluation_input_hash);

-- Composite index to optimize durable evaluation job queue polling, lease claims, and retry boundaries
CREATE INDEX IF NOT EXISTS idx_evaluation_jobs_queue_v2
  ON evaluation_jobs (status, available_at, attempts);
