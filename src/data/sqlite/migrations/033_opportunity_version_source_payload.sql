-- 033_opportunity_version_source_payload.sql
-- Durable source-payload provenance for canonical opportunity versions.
-- Additive only: existing HTML/text records remain unchanged and have NULLs.

ALTER TABLE opportunity_versions ADD COLUMN source_payload_key TEXT;
ALTER TABLE opportunity_versions ADD COLUMN source_media_type TEXT;
ALTER TABLE opportunity_versions ADD COLUMN document_extraction_state TEXT;

CREATE INDEX IF NOT EXISTS idx_opportunity_versions_source_payload_key
ON opportunity_versions(source_payload_key);
