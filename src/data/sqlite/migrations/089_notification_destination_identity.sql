-- Keep historical deliveries intact while allowing same-URL secret rotation.
-- URL remains in the key because pre-088 history can contain multiple URLs at revision 0.
CREATE TABLE notification_deliveries_next (
 id TEXT PRIMARY KEY, incident_id TEXT NOT NULL REFERENCES provider_incidents(id),
 event TEXT NOT NULL, destination_url TEXT NOT NULL, secret_envelope TEXT NOT NULL,
 payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt_at INTEGER NOT NULL, lease_token TEXT, lease_until INTEGER,
 error_code TEXT, delivered_at INTEGER, destination_revision INTEGER NOT NULL DEFAULT 0,
 UNIQUE(incident_id,event,destination_url,destination_revision)
);
INSERT INTO notification_deliveries_next
 (id,incident_id,event,destination_url,secret_envelope,payload_json,status,attempts,
  next_attempt_at,lease_token,lease_until,error_code,delivered_at,destination_revision)
 SELECT id,incident_id,event,destination_url,secret_envelope,payload_json,status,attempts,
  next_attempt_at,lease_token,lease_until,error_code,delivered_at,destination_revision
 FROM notification_deliveries;
DROP TABLE notification_deliveries;
ALTER TABLE notification_deliveries_next RENAME TO notification_deliveries;
