import type { DatabaseAdapter } from "../../data/database/adapter";

export const CRITICAL_EVALUATION_MAINTENANCE_TASKS = [
  "search_connection_receipt",
  "search_connection_validation",
  "host_provider_checks",
  "runtime_receipt",
  "credential_retention",
  "incident_reconciliation",
  "notification_delivery",
] as const;

export const CRITICAL_MAINTENANCE_BY_WORKER = {
  evaluation: CRITICAL_EVALUATION_MAINTENANCE_TASKS,
  "dossier-review": ["host_provider_checks"],
} as const;

export type MaintenanceTaskName = (typeof CRITICAL_EVALUATION_MAINTENANCE_TASKS)[number] | string;

export type MaintenanceTaskIdentity = {
  workerInstance: string;
  releaseSha: string;
  databaseFingerprint: string;
};

export type MaintenanceTask = {
  task: MaintenanceTaskName;
  operation: () => Promise<unknown>;
};

function safeErrorCode(error: unknown): string {
  const candidate = error instanceof Error ? error.message : "";
  return /^[A-Z][A-Z0-9_]{1,79}$/.test(candidate) ? candidate : "MAINTENANCE_TASK_FAILED";
}

/**
 * Persist task progress independently from worker liveness. Each operation is
 * allowed to fail without suppressing later maintenance tasks.
 */
export async function runMaintenanceTask<T>(
  db: DatabaseAdapter,
  identity: MaintenanceTaskIdentity,
  task: MaintenanceTaskName,
  operation: () => Promise<T>,
  now = Date.now(),
): Promise<{ success: boolean; value?: T; errorCode?: string }> {
  const key = [identity.workerInstance, task, identity.releaseSha, identity.databaseFingerprint];
  let taskError: unknown;
  let value: T | undefined;

  try {
    await db.execute(
      `INSERT INTO operations_maintenance_tasks
       (worker_instance,task,release_sha,database_fingerprint,last_started_at,last_success_at,consecutive_failures,error_code)
       VALUES (?,?,?,?,?,NULL,0,NULL)
       ON CONFLICT(worker_instance,task) DO UPDATE SET
         release_sha=excluded.release_sha,
         database_fingerprint=excluded.database_fingerprint,
         last_started_at=excluded.last_started_at`,
      [...key, now],
    );
  } catch (error) {
    taskError = error;
  }

  // Still perform useful maintenance if the receipt write failed. The heartbeat
  // will remain unhealthy because there will be no fresh success receipt.
  try {
    value = await operation();
  } catch (error) {
    taskError ??= error;
  }

  if (!taskError) {
    try {
      await db.execute(
        `UPDATE operations_maintenance_tasks
         SET last_success_at=?,consecutive_failures=0,error_code=NULL
         WHERE worker_instance=? AND task=? AND release_sha=? AND database_fingerprint=?`,
        [Date.now(), ...key],
      );
      return { success: true, value };
    } catch (error) {
      taskError = error;
    }
  }

  const errorCode = safeErrorCode(taskError);
  try {
    await db.execute(
      `UPDATE operations_maintenance_tasks
       SET consecutive_failures=consecutive_failures+1,error_code=?
       WHERE worker_instance=? AND task=? AND release_sha=? AND database_fingerprint=?`,
      [errorCode, ...key],
    );
  } catch {
    // The externally visible health query fails closed when the receipt cannot
    // be updated or queried. Do not prevent subsequent maintenance tasks.
  }
  return { success: false, errorCode };
}

/** Run every maintenance action independently without overlapping database transactions. */
export async function runMaintenanceTasks(
  db: DatabaseAdapter,
  identity: MaintenanceTaskIdentity,
  tasks: readonly MaintenanceTask[],
): Promise<Array<{ task: MaintenanceTaskName; success: boolean; errorCode?: string }>> {
  const results: Array<{ task: MaintenanceTaskName; success: boolean; errorCode?: string }> = [];
  for (const { task, operation } of tasks) {
    const result = await runMaintenanceTask(db, identity, task, operation);
    results.push({ task, success: result.success, errorCode: result.errorCode });
  }
  return results;
}
