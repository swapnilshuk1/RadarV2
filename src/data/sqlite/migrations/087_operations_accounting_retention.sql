-- Grace starts when the last active/candidate/previous reference is released.
ALTER TABLE provider_credential_lifecycle ADD COLUMN unreferenced_at INTEGER;
UPDATE provider_credential_lifecycle SET unreferenced_at=unixepoch()*1000
WHERE retired_at IS NULL AND NOT EXISTS (
  SELECT 1 FROM admin_search_connection c WHERE c.active_id=credential_id OR c.candidate_id=credential_id OR c.previous_id=credential_id
);
CREATE TRIGGER admin_search_connection_reference_age
AFTER UPDATE OF active_id,candidate_id,previous_id ON admin_search_connection
BEGIN
  UPDATE provider_credential_lifecycle SET unreferenced_at=NULL WHERE EXISTS (
    SELECT 1 FROM admin_search_connection c WHERE c.active_id=credential_id OR c.candidate_id=credential_id OR c.previous_id=credential_id
  );
  UPDATE provider_credential_lifecycle SET unreferenced_at=COALESCE(unreferenced_at,unixepoch()*1000)
  WHERE retired_at IS NULL AND NOT EXISTS (
    SELECT 1 FROM admin_search_connection c WHERE c.active_id=credential_id OR c.candidate_id=credential_id OR c.previous_id=credential_id
  );
END;
-- Stable episode event identity is distinct from per-destination delivery identity.
UPDATE notification_deliveries SET payload_json=json_set(payload_json,'$.eventId',incident_id || ':' || event);
