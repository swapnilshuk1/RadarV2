-- 041_indeed_resolution_provenance.sql
-- Preserve the exact navigation destination independently of the source URL.
-- Existing historical lineage is deliberately not backfilled or reinterpreted.

ALTER TABLE acquisition_ingestion_lineage ADD COLUMN resolved_url TEXT;

CREATE INDEX IF NOT EXISTS idx_acquisition_ingestion_lineage_source_identity
  ON acquisition_ingestion_lineage(source_portal, source_job_id, canonical_job_id);
