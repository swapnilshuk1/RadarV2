-- Migration 025: Canonical User Decisions (Phase M9.3)

CREATE TABLE IF NOT EXISTS canonical_decisions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  canonical_job_id TEXT NOT NULL REFERENCES canonical_opportunities(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('PURSUE', 'CONSIDER', 'PASS')),
  reason TEXT,
  reviewed_fingerprint TEXT,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (person_id, tenant_id) REFERENCES people(id, tenant_id),
  UNIQUE(tenant_id, person_id, canonical_job_id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_decisions_person 
  ON canonical_decisions(tenant_id, person_id);
