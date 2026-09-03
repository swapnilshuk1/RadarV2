-- 034_acquisition_ingestion_lineage.sql
-- Durable, append-only source-card to canonical-version provenance.
-- This is an acquisition audit record only; it does not participate in serving.

CREATE TABLE IF NOT EXISTS acquisition_ingestion_lineage (
    id TEXT PRIMARY KEY,
    scrape_run_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    person_id TEXT NOT NULL,
    acquisition_ledger_id TEXT NOT NULL,
    card_id TEXT NOT NULL,
    ingestion_attempt INTEGER NOT NULL CHECK (ingestion_attempt > 0),
    source_portal TEXT NOT NULL,
    source_job_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    capture_state TEXT NOT NULL,
    document_state TEXT NOT NULL,
    content_hash TEXT,
    canonical_job_id TEXT,
    opportunity_version TEXT,
    failure_class TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- A canonical identity is meaningful only as the exact job/version pair.
    CHECK (
      (canonical_job_id IS NULL AND opportunity_version IS NULL)
      OR (canonical_job_id IS NOT NULL AND opportunity_version IS NOT NULL)
    ),
    -- A successful canonical version must identify the immutable content it represents.
    CHECK (canonical_job_id IS NULL OR content_hash IS NOT NULL),
    UNIQUE (scrape_run_id, card_id, ingestion_attempt),
    FOREIGN KEY (scrape_run_id) REFERENCES scrape_runs(id),
    FOREIGN KEY (acquisition_ledger_id) REFERENCES acquisition_ledger(id),
    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
    FOREIGN KEY (person_id, tenant_id) REFERENCES people(id, tenant_id),
    FOREIGN KEY (canonical_job_id, opportunity_version)
      REFERENCES opportunity_versions(canonical_job_id, id)
);

CREATE INDEX IF NOT EXISTS idx_acquisition_ingestion_lineage_run
  ON acquisition_ingestion_lineage(scrape_run_id, created_at);

CREATE INDEX IF NOT EXISTS idx_acquisition_ingestion_lineage_canonical
  ON acquisition_ingestion_lineage(canonical_job_id, opportunity_version);
