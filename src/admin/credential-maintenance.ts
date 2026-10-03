import type { DatabaseAdapter } from "../data/database/adapter";

export async function maintainCredentialRetention(db: DatabaseAdapter, now = Date.now()) {
  const cutoff = now - 30 * 86400000;
  return db.transaction(async (tx) => {
    await tx.execute(
      `UPDATE provider_credential_lifecycle SET retired_at=? WHERE retired_at IS NULL AND unreferenced_at<=?
      AND NOT EXISTS (SELECT 1 FROM admin_search_connection c WHERE c.active_id=credential_id OR c.candidate_id=credential_id OR c.previous_id=credential_id)`,
      [now, cutoff],
    );
    await tx.execute(
      `UPDATE admin_search_credentials SET envelope_json='{"retired":true}'
      WHERE id IN (SELECT credential_id FROM provider_credential_lifecycle WHERE retired_at<=? AND secret_purged_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM admin_search_connection c WHERE c.active_id=admin_search_credentials.id OR c.candidate_id=admin_search_credentials.id OR c.previous_id=admin_search_credentials.id)`,
      [cutoff],
    );
    await tx.execute(
      `UPDATE provider_credential_lifecycle SET secret_purged_at=? WHERE secret_purged_at IS NULL
      AND credential_id IN (SELECT id FROM admin_search_credentials WHERE envelope_json='{"retired":true}')`,
      [now],
    );
  });
}
