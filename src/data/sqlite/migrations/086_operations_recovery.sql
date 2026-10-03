-- Additive operational state; host credentials and existing queue identities remain valid.
ALTER TABLE admin_search_connection ADD COLUMN previous_id TEXT REFERENCES admin_search_credentials(id);
ALTER TABLE dossier_review_jobs ADD COLUMN lease_mode TEXT NOT NULL DEFAULT 'serial' CHECK(lease_mode IN ('serial','independent'));
ALTER TABLE admin_search_connection ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE admin_search_connection ADD COLUMN activated_at INTEGER;
ALTER TABLE admin_search_connection ADD COLUMN uptake_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE admin_search_checks ADD COLUMN lease_token TEXT;
ALTER TABLE admin_search_checks ADD COLUMN worker_instance TEXT;
ALTER TABLE admin_search_checks ADD COLUMN release_sha TEXT;
ALTER TABLE admin_search_checks ADD COLUMN database_fingerprint TEXT;
CREATE TABLE provider_credential_lifecycle (
 credential_id TEXT PRIMARY KEY REFERENCES admin_search_credentials(id),
 activated_at INTEGER, superseded_at INTEGER, retired_at INTEGER,
 last_validated_at INTEGER, last_used_at INTEGER, key_version TEXT NOT NULL, secret_purged_at INTEGER
);
DROP TRIGGER admin_search_credentials_immutable;
CREATE TRIGGER admin_search_credentials_immutable BEFORE UPDATE ON admin_search_credentials
WHEN NOT (
 NEW.id=OLD.id AND NEW.suffix=OLD.suffix AND NEW.created_at=OLD.created_at AND NEW.created_by=OLD.created_by
 AND NEW.envelope_json='{"retired":true}'
 AND EXISTS(SELECT 1 FROM provider_credential_lifecycle l WHERE l.credential_id=OLD.id AND l.retired_at IS NOT NULL AND l.retired_at<=(unixepoch()*1000-2592000000))
 AND NOT EXISTS(SELECT 1 FROM admin_search_connection c WHERE c.active_id=OLD.id OR c.candidate_id=OLD.id OR c.previous_id=OLD.id)
)
BEGIN SELECT RAISE(ABORT,'SEARCH_CREDENTIAL_IMMUTABLE'); END;
CREATE TABLE worker_runtime_receipts (
 instance_id TEXT NOT NULL, connection_id TEXT NOT NULL, worker_name TEXT NOT NULL,
 runtime_role TEXT NOT NULL, release_sha TEXT NOT NULL, database_fingerprint TEXT NOT NULL,
 config_revision TEXT NOT NULL, generation INTEGER NOT NULL, credential_version TEXT,
 credential_source TEXT NOT NULL, reload_mode TEXT NOT NULL, reload_status TEXT NOT NULL,
 error_code TEXT, started_at INTEGER NOT NULL, loaded_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL,
 effective_settings_json TEXT NOT NULL DEFAULT '{}',
 PRIMARY KEY(instance_id,connection_id)
);
CREATE TABLE provider_incidents (
 id TEXT PRIMARY KEY, correlation_key TEXT NOT NULL, provider TEXT NOT NULL,
 connection_id TEXT NOT NULL, generation INTEGER NOT NULL, failure_class TEXT NOT NULL,
 severity TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('open','acknowledged','recovering','resolved')),
 recurrence_of TEXT REFERENCES provider_incidents(id), first_seen INTEGER NOT NULL,
 last_seen INTEGER NOT NULL, occurrences INTEGER NOT NULL DEFAULT 1, error_code TEXT NOT NULL,
 acknowledged_by TEXT, acknowledged_at INTEGER, snoozed_until INTEGER NOT NULL DEFAULT 0,
 resolved_at INTEGER
);
CREATE UNIQUE INDEX provider_incident_open ON provider_incidents(correlation_key) WHERE state!='resolved';
CREATE TABLE provider_incident_observations (
 id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES provider_incidents(id),
 observed_at INTEGER NOT NULL, error_code TEXT NOT NULL
);
CREATE TABLE provider_incident_jobs (
 incident_id TEXT NOT NULL REFERENCES provider_incidents(id), pipeline TEXT NOT NULL,
 job_id TEXT NOT NULL, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL,
 canonical_job_id TEXT NOT NULL, opportunity_version TEXT NOT NULL, context_fingerprint TEXT NOT NULL,
 accounted_reason TEXT, PRIMARY KEY(incident_id,pipeline,job_id)
);
CREATE TABLE provider_cooldowns (
 connection_id TEXT PRIMARY KEY, generation INTEGER NOT NULL, blocked_until INTEGER NOT NULL,
 requires_action INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
 failure_class TEXT NOT NULL, last_success_at INTEGER
);
CREATE TABLE provider_capacity_leases (
 token TEXT PRIMARY KEY, connection_id TEXT NOT NULL, owner TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX provider_capacity_active ON provider_capacity_leases(connection_id,expires_at);
CREATE TABLE provider_rate_windows (
 connection_id TEXT PRIMARY KEY, window_start INTEGER NOT NULL, requests INTEGER NOT NULL
);
CREATE TABLE operational_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0,
 settings_json TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
);
INSERT INTO operational_settings VALUES(1,0,'{"evaluation":2,"dossier":2,"factual_review":1,"pursuit":2,"providerConcurrency":4,"profile":"Normal","cohortLimit":20}',0,'migration');
CREATE TABLE recovery_actions (
 id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES provider_incidents(id),
 state TEXT NOT NULL CHECK(state IN ('previewed','requested','executing','completed','partially_completed','cancelled','failed')),
 generation INTEGER NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 created_by TEXT NOT NULL, reason TEXT NOT NULL, completed_at INTEGER
);
CREATE TABLE recovery_action_jobs (
 action_id TEXT NOT NULL REFERENCES recovery_actions(id), pipeline TEXT NOT NULL,
 job_id TEXT NOT NULL, identity_json TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'selected',
 reason TEXT, PRIMARY KEY(action_id,pipeline,job_id)
);
CREATE TABLE operational_webhooks (
 id INTEGER PRIMARY KEY CHECK(id=1), url TEXT NOT NULL, secret_envelope TEXT NOT NULL,
 minimum_severity TEXT NOT NULL, send_recovery INTEGER NOT NULL,
 updated_at INTEGER NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE notification_deliveries (
 id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES provider_incidents(id),
 event TEXT NOT NULL, destination_url TEXT NOT NULL, secret_envelope TEXT NOT NULL,
 payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER,
 error_code TEXT, delivered_at INTEGER, UNIQUE(incident_id,event,destination_url)
);
CREATE TABLE provider_host_checks (
 id TEXT PRIMARY KEY, provider TEXT NOT NULL CHECK(provider IN ('bedrock','google')),
 status TEXT NOT NULL CHECK(status IN ('queued','running','passed','failed')),
 created_at INTEGER NOT NULL, created_by TEXT NOT NULL, lease_token TEXT, lease_until INTEGER,
 worker_name TEXT, worker_instance TEXT, release_sha TEXT, database_fingerprint TEXT,
 completed_at INTEGER, error_code TEXT, details_json TEXT
);
CREATE UNIQUE INDEX provider_host_check_live ON provider_host_checks(provider) WHERE status IN ('queued','running');
