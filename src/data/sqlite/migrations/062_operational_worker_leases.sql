-- Operational ownership for crash-safe scraper claims and worker liveness.
ALTER TABLE scrape_runs ADD COLUMN lease_owner TEXT;
ALTER TABLE scrape_runs ADD COLUMN lease_token TEXT;
ALTER TABLE scrape_runs ADD COLUMN lease_expires_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_scrape_runs_claimable
  ON scrape_runs(status, lease_expires_at, created_at);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_name TEXT NOT NULL,
  instance_id TEXT NOT NULL,
  release_sha TEXT NOT NULL,
  database_fingerprint TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (worker_name, instance_id)
);
CREATE INDEX IF NOT EXISTS idx_worker_heartbeats_seen
  ON worker_heartbeats(worker_name, last_seen_at);
