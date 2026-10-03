-- Preserve existing credential/work identity while adding explicit recovery proof.
ALTER TABLE admin_search_connection ADD COLUMN previous_source TEXT CHECK(previous_source IN ('host','managed'));
UPDATE admin_search_connection SET previous_source='managed' WHERE previous_id IS NOT NULL;
CREATE TABLE admin_search_checks_next (
 id TEXT PRIMARY KEY, credential_id TEXT REFERENCES admin_search_credentials(id),
 status TEXT NOT NULL CHECK(status IN ('queued','running','passed','failed')),
 created_at INTEGER NOT NULL, created_by TEXT NOT NULL, completed_at INTEGER,
 lease_until INTEGER, worker_host TEXT, error_code TEXT, lease_token TEXT,
 worker_instance TEXT, release_sha TEXT, database_fingerprint TEXT,
 source TEXT NOT NULL DEFAULT 'managed' CHECK(source IN ('host','managed')),
 generation INTEGER, purpose TEXT NOT NULL DEFAULT 'validate', capability_version INTEGER NOT NULL DEFAULT 0,
 CHECK((source='host' AND credential_id IS NULL) OR (source='managed' AND credential_id IS NOT NULL))
);
INSERT INTO admin_search_checks_next(id,credential_id,status,created_at,created_by,completed_at,lease_until,worker_host,error_code,lease_token,worker_instance,release_sha,database_fingerprint)
 SELECT id,credential_id,status,created_at,created_by,completed_at,lease_until,worker_host,error_code,lease_token,worker_instance,release_sha,database_fingerprint FROM admin_search_checks;
DROP TABLE admin_search_checks;
ALTER TABLE admin_search_checks_next RENAME TO admin_search_checks;
CREATE UNIQUE INDEX admin_search_check_active ON admin_search_checks(COALESCE(credential_id,'host')) WHERE status IN ('queued','running');
ALTER TABLE provider_credential_lifecycle ADD COLUMN last_success_at INTEGER;
ALTER TABLE provider_cooldowns ADD COLUMN active_incident_id TEXT REFERENCES provider_incidents(id);
UPDATE provider_cooldowns SET active_incident_id=COALESCE(
 (SELECT id FROM provider_incidents i WHERE i.connection_id=provider_cooldowns.connection_id AND i.failure_class=provider_cooldowns.failure_class AND i.state!='resolved' ORDER BY i.last_seen DESC LIMIT 1),
 (SELECT id FROM provider_incidents i WHERE i.connection_id=provider_cooldowns.connection_id AND i.state!='resolved' ORDER BY i.last_seen DESC LIMIT 1));
ALTER TABLE provider_incident_observations ADD COLUMN release_sha TEXT;
ALTER TABLE provider_incident_observations ADD COLUMN database_fingerprint TEXT;
ALTER TABLE provider_incidents ADD COLUMN first_release_sha TEXT;
ALTER TABLE provider_incidents ADD COLUMN last_release_sha TEXT;
CREATE TABLE operations_maintenance_tasks (
 worker_instance TEXT NOT NULL, task TEXT NOT NULL, release_sha TEXT NOT NULL,
 database_fingerprint TEXT NOT NULL, last_started_at INTEGER NOT NULL,
 last_success_at INTEGER, consecutive_failures INTEGER NOT NULL DEFAULT 0,
 error_code TEXT, PRIMARY KEY(worker_instance,task)
);
ALTER TABLE operational_webhooks ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE notification_deliveries ADD COLUMN destination_revision INTEGER NOT NULL DEFAULT 0;
