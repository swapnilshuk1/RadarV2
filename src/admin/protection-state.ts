import type { DatabaseAdapter } from "../data/database/adapter";
export async function protectionState(db: DatabaseAdapter): Promise<string | null> {
  if (
    !(await db.one(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='admin_protection_versions'",
    ))
  )
    return null;
  const row = await db.one<{ version: number }>(
    "SELECT version FROM admin_protection_versions WHERE scope='platform'",
  );
  return String(row?.version ?? 0);
}
