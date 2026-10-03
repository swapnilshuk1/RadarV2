import { getDatabaseAdapter, getDatabaseTargetIdentity } from "../../data/database";
import {
  verifyMigrationChecksums,
  verifyRequiredSchema,
} from "../../data/sqlite/migrations/runner";
import {
  REQUIRED_WORKERS,
  WORKER_HEARTBEAT_STALE_MS,
  requiredWorkersForEnvironment,
} from "./worker-heartbeat";
import { operationsInstalled } from "../../admin/operations-runtime";
import { CRITICAL_EVALUATION_MAINTENANCE_TASKS } from "./maintenance-receipts";

export type ReadinessPayload = {
  readonly status: "ready" | "unavailable";
  readonly releaseSha: string;
};

function releaseSha(): string {
  // This is injected by the verified release manifest at activation time. It is
  // deliberately the only deployment detail exposed by the public probe.
  return process.env.RADAR_RELEASE_SHA ?? "development";
}

export async function getReadiness(): Promise<{ status: number; body: ReadinessPayload }> {
  try {
    const db = getDatabaseAdapter();
    await verifyMigrationChecksums(db);
    await verifyRequiredSchema(db);
    return { status: 200, body: { status: "ready", releaseSha: releaseSha() } };
  } catch {
    return { status: 503, body: { status: "unavailable", releaseSha: releaseSha() } };
  }
}

export async function readyResponse(): Promise<Response> {
  const readiness = await getReadiness();
  return new Response(JSON.stringify(readiness.body), {
    status: readiness.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

/** External uptime monitors can detect maintenance loss without relying on the dead worker's notification loop. */
export async function getOperationsReadiness(): Promise<{
  status: number;
  body: ReadinessPayload;
}> {
  try {
    const db = getDatabaseAdapter();
    const installed = await operationsInstalled(db);
    const sha = releaseSha();
    const fingerprint = getDatabaseTargetIdentity().fingerprint;
    const now = Date.now();
    const cutoff = now - WORKER_HEARTBEAT_STALE_MS;
    const workers = installed
      ? await db.many<{ instance_id: string }>(
          `SELECT instance_id FROM worker_heartbeats
           WHERE worker_name='evaluation' AND release_sha=? AND database_fingerprint=? AND last_seen_at>=?`,
          [sha, fingerprint, new Date(cutoff).toISOString()],
        )
      : [];
    let healthyWorkerFound = false;
    for (const worker of workers) {
      const receipts = await db.many<{
        task: string;
        last_success_at: number | null;
        consecutive_failures: number;
      }>(
        `SELECT task,last_success_at,consecutive_failures
         FROM operations_maintenance_tasks
         WHERE worker_instance=? AND release_sha=? AND database_fingerprint=?`,
        [worker.instance_id, sha, fingerprint],
      );
      const byTask = new Map(receipts.map((receipt) => [receipt.task, receipt]));
      const current = CRITICAL_EVALUATION_MAINTENANCE_TASKS.every((task) => {
        const receipt = byTask.get(task);
        return Boolean(
          receipt &&
          receipt.last_success_at !== null &&
          receipt.last_success_at >= cutoff &&
          receipt.consecutive_failures === 0,
        );
      });
      if (current) {
        healthyWorkerFound = true;
        break;
      }
    }
    const ready = installed && healthyWorkerFound;
    return {
      status: ready ? 200 : 503,
      body: { status: ready ? "ready" : "unavailable", releaseSha: releaseSha() },
    };
  } catch {
    return { status: 503, body: { status: "unavailable", releaseSha: releaseSha() } };
  }
}
export async function operationsReadyResponse(): Promise<Response> {
  const result = await getOperationsReadiness();
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export type SystemReadinessPayload = {
  readonly status: "ready" | "unavailable";
  readonly releaseSha: string;
  readonly workers: {
    readonly required: number;
    readonly healthy: number;
    readonly missing: string[];
  };
};

export async function getSystemReadiness(
  staleAfterMs = WORKER_HEARTBEAT_STALE_MS,
): Promise<{ status: number; body: SystemReadinessPayload }> {
  const sha = releaseSha();
  let requiredWorkers: readonly string[] = REQUIRED_WORKERS;
  const unavailable = (missing: string[]) => ({
    status: 503,
    body: {
      status: "unavailable" as const,
      releaseSha: sha,
      workers: {
        required: requiredWorkers.length,
        healthy: requiredWorkers.length - missing.length,
        missing,
      },
    },
  });
  try {
    requiredWorkers = requiredWorkersForEnvironment();
    const db = getDatabaseAdapter();
    const expectedFingerprint = getDatabaseTargetIdentity().fingerprint;
    const cutoff = new Date(Date.now() - staleAfterMs).toISOString();
    const rows = await db.many<{
      worker_name: string;
      release_sha: string;
      database_fingerprint: string;
      last_seen_at: string;
    }>(
      `SELECT worker_name,release_sha,database_fingerprint,last_seen_at
       FROM worker_heartbeats WHERE last_seen_at >= ? ORDER BY last_seen_at DESC`,
      [cutoff],
    );
    const healthy = new Set<string>();
    for (const row of rows) {
      if (row.release_sha === sha && row.database_fingerprint === expectedFingerprint)
        healthy.add(row.worker_name);
    }
    const missing = requiredWorkers.filter((name) => !healthy.has(name));
    if (missing.length) return unavailable([...missing]);
    return {
      status: 200,
      body: {
        status: "ready",
        releaseSha: sha,
        workers: { required: requiredWorkers.length, healthy: requiredWorkers.length, missing: [] },
      },
    };
  } catch {
    return unavailable([...requiredWorkers]);
  }
}

export async function systemReadyResponse(): Promise<Response> {
  const readiness = await getSystemReadiness();
  return new Response(JSON.stringify(readiness.body), {
    status: readiness.status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
