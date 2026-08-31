-- Migration 029: Add scalar vetoed column to materialized_evaluations
-- Milestone: Durable Architecture Serving Migration (Gate 0 Remediation)
-- Invariant: Additive only. Preserves all JSON semantics. Replaces request-time access to 30 MB JSON artifact in feed SQL.

-- 1. Add scalar vetoed column with DEFAULT 0 (not null)
ALTER TABLE materialized_evaluations ADD COLUMN vetoed INTEGER NOT NULL DEFAULT 0;

-- 2. Index for tenant/person scoped feed and tier evaluation
CREATE INDEX IF NOT EXISTS idx_materialized_eval_vetoed
    ON materialized_evaluations(tenant_id, person_id, vetoed);

-- 3. Backfill scalar from evaluation_json (handles $.vetoed, $.record.vetoed, $.engineRecommendation.vetoed)
UPDATE materialized_evaluations
SET vetoed = 1
WHERE (
  json_extract(evaluation_json, '$.record.vetoed') = 1
  OR json_extract(evaluation_json, '$.vetoed') = 1
  OR json_extract(evaluation_json, '$.engineRecommendation.vetoed') = 1
  OR json_extract(evaluation_json, '$.record.vetoed') = true
  OR json_extract(evaluation_json, '$.vetoed') = true
  OR json_extract(evaluation_json, '$.engineRecommendation.vetoed') = true
);
