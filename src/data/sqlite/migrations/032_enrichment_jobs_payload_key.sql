-- 032_enrichment_jobs_payload_key.sql
-- RADAR v2 — Phase 4B: Add payload_key to enrichment_jobs for durable BlobStore references.
-- Decouples job processing from the host container filesystem.

ALTER TABLE enrichment_jobs ADD COLUMN payload_key TEXT;

UPDATE enrichment_jobs 
SET payload_key = COALESCE(payload_key, snapshot_path) 
WHERE payload_key IS NULL;

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_payload_key 
ON enrichment_jobs(payload_key);
