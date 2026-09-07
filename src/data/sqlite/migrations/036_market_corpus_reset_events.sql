-- 036: Durable operational market-corpus reset transition ledger.
--
-- This does not retire or delete market records.  It records the bounded
-- switch from one serving context to an empty, prepared successor so the
-- historical graph remains available for later archival decisions.

CREATE TABLE IF NOT EXISTS market_corpus_reset_events (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  previous_search_plan_id TEXT NOT NULL,
  previous_context_fingerprint TEXT NOT NULL,
  successor_search_plan_id TEXT NOT NULL,
  successor_context_fingerprint TEXT NOT NULL,
  pre_reset_manifest_json TEXT NOT NULL,
  pre_reset_manifest_sha256 TEXT NOT NULL,
  candidate_profile_hash TEXT NOT NULL,
  candidate_projection_hash TEXT NOT NULL,
  location_policy TEXT NOT NULL,
  release_commit TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PREPARED', 'ACTIVATED', 'VERIFIED', 'ABORTED')),
  activated_at DATETIME,
  verified_at DATETIME,
  verification_json TEXT,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (tenant_id, person_id, successor_search_plan_id)
);

CREATE INDEX IF NOT EXISTS idx_market_corpus_reset_events_scope_status
  ON market_corpus_reset_events (tenant_id, person_id, status, created_at DESC);
