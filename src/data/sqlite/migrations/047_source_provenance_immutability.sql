-- 047_source_provenance_immutability.sql
-- Gate 1B Batch 01: make durable candidate/role source identities non-rewritable.
-- Operational/derived lifecycle columns remain mutable; source identity does not.
--
-- Candidate source text is physically immutable because document_contents is the
-- durable source record. Opportunity-version text may still be fault-injected by
-- low-level tests/maintenance, so exact role resolution independently recomputes
-- and verifies the canonical content hash. Binary source pointers are immutable.

CREATE TRIGGER IF NOT EXISTS trg_candidate_documents_source_identity_immutable
BEFORE UPDATE OF person_id, mime_type, document_hash
ON candidate_documents
FOR EACH ROW
WHEN NEW.person_id IS NOT OLD.person_id
  OR NEW.mime_type IS NOT OLD.mime_type
  OR NEW.document_hash IS NOT OLD.document_hash
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_CANDIDATE_DOCUMENT_SOURCE');
END;

CREATE TRIGGER IF NOT EXISTS trg_document_contents_source_immutable
BEFORE UPDATE OF id, document_id, raw_text, text_hash
ON document_contents
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id
  OR NEW.document_id IS NOT OLD.document_id
  OR NEW.raw_text IS NOT OLD.raw_text
  OR NEW.text_hash IS NOT OLD.text_hash
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_CANDIDATE_SOURCE_CONTENT');
END;

CREATE TRIGGER IF NOT EXISTS trg_opportunity_versions_source_identity_immutable
BEFORE UPDATE OF
  id,
  canonical_job_id,
  content_hash,
  job_title,
  company_name,
  location,
  employment_type,
  source_payload_key,
  source_media_type
ON opportunity_versions
FOR EACH ROW
WHEN NEW.id IS NOT OLD.id
  OR NEW.canonical_job_id IS NOT OLD.canonical_job_id
  OR NEW.content_hash IS NOT OLD.content_hash
  OR NEW.job_title IS NOT OLD.job_title
  OR NEW.company_name IS NOT OLD.company_name
  OR NEW.location IS NOT OLD.location
  OR NEW.employment_type IS NOT OLD.employment_type
  OR NEW.source_payload_key IS NOT OLD.source_payload_key
  OR NEW.source_media_type IS NOT OLD.source_media_type
BEGIN
  SELECT RAISE(ABORT, 'IMMUTABLE_OPPORTUNITY_VERSION_SOURCE');
END;
