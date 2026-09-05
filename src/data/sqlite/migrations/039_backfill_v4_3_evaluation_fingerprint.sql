-- Migration 039: materialized_evaluations is rebuildable derived state.
-- Backfill only the exact fingerprint already persisted in a valid v4.3
-- artifact; never infer identity from evaluation context or legacy payloads.
UPDATE materialized_evaluations
SET evaluation_fingerprint = json_extract(evaluation_json, '$.evaluationInputHash')
WHERE (evaluation_fingerprint IS NULL OR TRIM(evaluation_fingerprint) = '')
  AND json_valid(evaluation_json)
  AND json_extract(evaluation_json, '$.schemaVersion') = 'v4.3-intrinsic'
  AND json_extract(evaluation_json, '$.evaluationContractVersion') = 'v4.3'
  AND typeof(json_extract(evaluation_json, '$.evaluationInputHash')) = 'text'
  AND TRIM(json_extract(evaluation_json, '$.evaluationInputHash')) <> '';
