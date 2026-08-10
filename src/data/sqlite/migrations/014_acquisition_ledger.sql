-- Migration 014: Persistent Job Acquisition Ledger with UUID PK, Lease Management & Failure Taxonomy

CREATE TABLE IF NOT EXISTS acquisition_ledger (
  id TEXT PRIMARY KEY,                       -- Internal UUID
  canonical_job_id TEXT NOT NULL,           -- e.g. "linkedin:4450224496"
  source_portal TEXT NOT NULL,              -- "LinkedIn", "Naukri", "Indeed"
  source_job_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  title TEXT NOT NULL,
  company_name TEXT NOT NULL,
  location TEXT,
  
  -- Lifecycle & Lease Management
  state TEXT NOT NULL DEFAULT 'DISCOVERED', -- DISCOVERED, QUEUED, CLAIMED, ACQUIRING, VALIDATED, ENRICHED, EVALUATED
  terminal_state TEXT,                     -- DUPLICATE, CHALLENGE, PERMANENT_FAILURE, EXPIRED, DISCARDED
  claimed_by TEXT,                         -- Worker ID / PID
  claimed_at TEXT,                         -- ISO timestamp
  lease_expires_at TEXT,                   -- Lease expiry timestamp (default +5m)
  attempt_count INTEGER DEFAULT 0,
  
  -- Quality & Telemetry
  last_failure_class TEXT,                 -- Failure class from Taxonomy
  last_acquisition_method TEXT,            -- HTTP_FASTPATH, BROWSER_DOM
  acquisition_quality TEXT,                -- COMPLETE, PARTIAL, DEGRADED, INVALID
  validation_confidence TEXT,             -- HIGH, MEDIUM, LOW, UNUSABLE
  
  -- Freshness Lifecycle
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_acquired_at TEXT,
  freshness_state TEXT DEFAULT 'NEW',      -- NEW, FRESH, AGING, STALE, EXPIRED
  
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  
  CONSTRAINT uq_portal_canonical UNIQUE (source_portal, canonical_job_id)
);

CREATE INDEX IF NOT EXISTS idx_acq_state_lease ON acquisition_ledger (state, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_acq_portal_state ON acquisition_ledger (source_portal, state);
CREATE INDEX IF NOT EXISTS idx_acq_freshness ON acquisition_ledger (freshness_state);
