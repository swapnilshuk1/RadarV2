import { randomUUID } from "node:crypto";
import {
  getDatabaseAdapter,
  getDatabaseTargetIdentity,
  type DatabaseAdapter,
} from "../../data/database";
import { describeBlobStoreConfiguration } from "../storage/blob-store";
import { runMaintenanceTasks } from "./maintenance-receipts";

export const REQUIRED_WORKERS = [
  "scrape",
  "enrichment",
  "documents",
  "evaluation",
  "dossier-composition",
  "dossier-review",
  "corpus",
  "pursuit-preparation",
] as const;
export const OPTIONAL_WORKERS = ["admin-bench"] as const;
export type RequiredWorkerName =
  (typeof REQUIRED_WORKERS)[number] | (typeof OPTIONAL_WORKERS)[number];
export const WORKER_HEARTBEAT_STALE_MS = 150_000;

export function assertWorkerPlacement(
  workerName: RequiredWorkerName,
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.RADAR_RUNTIME_ROLE === "acquisition" && workerName !== "scrape") {
    throw new Error("PROCESSING_WORKER_DISABLED_ON_ACQUISITION_HOST");
  }
  if (env.RADAR_RUNTIME_ROLE === "processing" && workerName === "scrape") {
    throw new Error("PORTAL_ACQUISITION_DISABLED_ON_PROCESSING_HOST");
  }
}

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
  const databaseFingerprint =
    options.databaseFingerprint ?? getDatabaseTargetIdentity().fingerprint;
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
  describeBlobStoreConfiguration(env);
  const required =
    env.RADAR_SERVER_SCRAPER_ENABLED === "true"
      ? REQUIRED_WORKERS
      : REQUIRED_WORKERS.filter((name) => name !== "scrape");
  return env.RADAR_ADMIN_BENCH_ENABLED === "true" ? [...required, "admin-bench"] : required;
}

export async function startWorkerHeartbeat(
  workerName: RequiredWorkerName,
  intervalMs = 60_000,
): Promise<{ instanceId: string; stop: () => void }> {
  // Production must explicitly declare single-host vs distributed storage;
  // distributed workers must have shared remote object storage configured.
  describeBlobStoreConfiguration();
  const db = getDatabaseAdapter();
  assertWorkerPlacement(workerName);
  const identity = getDatabaseTargetIdentity();
  const releaseSha = process.env.RADAR_RELEASE_SHA ?? "development";
  const instanceId = `${workerName}-${process.pid}-${randomUUID()}`;
  const startedAt = Date.now();
  const connections = await import("../../admin/search-connections");
  connections.registerConnectionWorker(workerName, instanceId, identity.fingerprint);
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
    const operations = await import("../../admin/operations-runtime");
    if (await operations.operationsInstalled(db)) {
      const hostChecks = await import("../../admin/host-provider-checks");
      const loaded = operations.effectiveOperationalRevision();

      const taskIdentity = {
        workerInstance: instanceId,
        releaseSha,
        databaseFingerprint: identity.fingerprint,
      };
      const tasks: Array<{ task: string; operation: () => Promise<unknown> }> = [
        {
          task: "search_connection_receipt",
          operation: () => connections.refreshSearchWorkerReceipt(db),
        },
        {
          task: "runtime_receipt",
          operation: () =>
            operations.writeRuntimeReceipt(db, {
              workerName,
              instanceId,
              runtimeRole: process.env.RADAR_RUNTIME_ROLE ?? "single-host",
              releaseSha,
              databaseFingerprint: identity.fingerprint,
              configRevision: loaded === undefined ? "not-loaded" : `operational:${loaded}`,
              connectionId: "runtime",
              generation: loaded ?? 0,
              credentialVersion: null,
              credentialSource: "host",
              reloadMode: "hot",
              reloadStatus: loaded === undefined ? "pending" : "loaded",
              errorCode: null,
              startedAt,
              loadedAt: Date.now(),
              lastSeenAt: Date.now(),
              effectiveSettings: operations.effectiveOperationalSettings(),
            }),
        },
      ];
      if (workerName === "evaluation") {
        const recovery = await import("../../admin/operations-recovery");
        const { maintainCredentialRetention: runRetention } =
          await import("../../admin/credential-maintenance");
        const notifications = await import("../../admin/notification-worker");
        tasks.push(
          {
            task: "notification_delivery",
            operation: () => notifications.pollNotificationDeliveries(db, 10),
          },
          { task: "credential_retention", operation: () => runRetention(db) },
          {
            task: "incident_reconciliation",
            operation: () => recovery.reconcileProviderIncidents(db),
          },
        );
      }
      tasks.push(
        {
          task: "search_connection_validation",
          operation: () => connections.pollSearchConnectionCheck(db),
        },
        {
          task: "host_provider_checks",
          operation: () =>
            hostChecks.pollHostProviderCheck(db, {
              name: workerName,
              instance: instanceId,
              database: identity.fingerprint,
            }),
        },
      );
      const results = await runMaintenanceTasks(db, taskIdentity, tasks);
      for (const result of results)
        if (!result.success)
          console.error("RADAR_MAINTENANCE_TASK_FAILED", {
            workerName,
            task: result.task,
            errorCode: result.errorCode,
          });
    }
  };
  await db.execute("DELETE FROM worker_heartbeats WHERE last_seen_at < ?", [
    new Date(Date.now() - 86_400_000).toISOString(),
  ]);
  await beat();
  let inFlight = false;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = true;
    void beat()
      .catch((error: unknown) => {
        const code =
          error instanceof Error && /^[A-Z][A-Z0-9_]{1,79}$/.test(error.message)
            ? error.message
            : "WORKER_HEARTBEAT_FAILED";
        console.error("RADAR_WORKER_HEARTBEAT_FAILED", { workerName, errorCode: code });
      })
      .finally(() => {
        inFlight = false;
      });
  }, intervalMs);
  timer.unref();
  return { instanceId, stop: () => clearInterval(timer) };
}
