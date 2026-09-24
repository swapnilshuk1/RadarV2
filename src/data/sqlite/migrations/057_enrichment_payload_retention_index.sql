-- Retention cleanup checks whether a terminal payload is still referenced by
-- active work. Keep that correlated lookup bounded to one payload key.
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_payload_status
  ON enrichment_jobs(payload_key, status)
  WHERE payload_key IS NOT NULL;
