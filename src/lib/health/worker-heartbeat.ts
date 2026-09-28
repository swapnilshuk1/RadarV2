import { randomUUID } from "node:crypto";
import { getDatabaseAdapter, getDatabaseTargetIdentity, type DatabaseAdapter } from "../../data/database";
import { describeBlobStoreConfiguration } from "../storage/blob-store";

export const REQUIRED_WORKERS = [
  "scrape",
  "enrichment",
  "documents",
  "evaluation",
  "dossier-composition",
  "dossier-review",
  "corpus",
] as const;
export type RequiredWorkerName = (typeof REQUIRED_WORKERS)[number];
export const WORKER_HEARTBEAT_STALE_MS = 150_000;

export async function isWorkerOnline(
  workerName: RequiredWorkerName,
  options: {
    db?: DatabaseAdapter;
    staleAfterMs?: number;
    now?: number;
    releaseSha?: string;
    databaseFingerprint?: string;
  } = {},
): Promise<boolean> {
  const db = options.db ?? getDatabaseAdapter();
  const staleAfterMs = options.staleAfterMs ?? WORKER_HEARTBEAT_STALE_MS;
  const cutoff = new Date((options.now ?? Date.now()) - staleAfterMs).toISOString();
  const releaseSha = options.releaseSha ?? process.env.RADAR_RELEASE_SHA ?? "development";
  const databaseFingerprint = options.databaseFingerprint ?? getDatabaseTargetIdentity().fingerprint;
  const row = await db.one<{ instance_id: string }>(
    `SELECT instance_id
     FROM worker_heartbeats
     WHERE worker_name=?
       AND release_sha=?
       AND database_fingerprint=?
       AND last_seen_at>=?
     ORDER BY last_seen_at DESC
     LIMIT 1`,
    [workerName, releaseSha, databaseFingerprint, cutoff],
  );
  return Boolean(row);
}

export function requiredWorkersForEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): readonly RequiredWorkerName[] {
  return describeBlobStoreConfiguration(env).mode === "distributed"
    ? REQUIRED_WORKERS.filter((name) => name !== "scrape")
    : REQUIRED_WORKERS;
}

export async function startWorkerHeartbeat(
  workerName: RequiredWorkerName,
  intervalMs = 60_000,
): Promise<{ instanceId: string; stop: () => void }> {
  // Production must explicitly declare single-host vs distributed storage;
  // distributed workers must have shared remote object storage configured.
  describeBlobStoreConfiguration();
  const db = getDatabaseAdapter();
  const identity = getDatabaseTargetIdentity();
  const releaseSha = process.env.RADAR_RELEASE_SHA ?? "development";
  const instanceId = `${workerName}-${process.pid}-${randomUUID()}`;
  const beat = async () => {
    await db.execute(
      `INSERT INTO worker_heartbeats (worker_name,instance_id,release_sha,database_fingerprint,last_seen_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(worker_name,instance_id) DO UPDATE SET
         release_sha=excluded.release_sha,
         database_fingerprint=excluded.database_fingerprint,
         last_seen_at=excluded.last_seen_at`,
      [workerName, instanceId, releaseSha, identity.fingerprint, new Date().toISOString()],
    );
  };
  await db.execute("DELETE FROM worker_heartbeats WHERE last_seen_at < ?", [new Date(Date.now() - 86_400_000).toISOString()]);
  await beat();
  const timer = setInterval(() => { void beat().catch(() => undefined); }, intervalMs);
  timer.unref();
  return { instanceId, stop: () => clearInterval(timer) };
}
