CREATE TABLE admin_search_credentials (
 id TEXT PRIMARY KEY, envelope_json TEXT NOT NULL, suffix TEXT NOT NULL,
 created_at INTEGER NOT NULL, created_by TEXT NOT NULL
);
CREATE TABLE admin_search_connection (
 id INTEGER PRIMARY KEY CHECK(id=1), active_id TEXT REFERENCES admin_search_credentials(id),
 candidate_id TEXT REFERENCES admin_search_credentials(id), generation INTEGER NOT NULL DEFAULT 0,
 blocked_until INTEGER NOT NULL DEFAULT 0, failure_code TEXT,
 updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
);
INSERT INTO admin_search_connection VALUES(1,NULL,NULL,0,0,NULL,0,'migration');
CREATE TABLE admin_search_checks (
 id TEXT PRIMARY KEY, credential_id TEXT NOT NULL REFERENCES admin_search_credentials(id),
 status TEXT NOT NULL CHECK(status IN ('queued','running','passed','failed')),
 created_at INTEGER NOT NULL, created_by TEXT NOT NULL,
 completed_at INTEGER, lease_until INTEGER, worker_host TEXT, error_code TEXT
);
CREATE UNIQUE INDEX admin_search_check_active ON admin_search_checks(credential_id)
 WHERE status IN ('queued','running');
CREATE TABLE admin_search_observations (
 worker_id TEXT PRIMARY KEY, hostname TEXT NOT NULL, generation INTEGER NOT NULL,
 credential_source TEXT NOT NULL, observed_at INTEGER NOT NULL
);
CREATE TRIGGER admin_search_credentials_immutable BEFORE UPDATE ON admin_search_credentials
BEGIN SELECT RAISE(ABORT,'SEARCH_CREDENTIAL_IMMUTABLE'); END;
