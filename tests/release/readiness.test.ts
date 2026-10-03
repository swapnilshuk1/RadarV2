import { afterEach, describe, expect, it } from "vitest";
import {
  getReadiness,
  getSystemReadiness,
  getOperationsReadiness,
  operationsReadyResponse,
} from "../../src/lib/health/readiness";
import {
  getDatabaseAdapter,
  getDatabaseTargetIdentity,
  resetDatabaseAdapter,
} from "../../src/data/database";
import {
  isWorkerOnline,
  REQUIRED_WORKERS,
  requiredWorkersForEnvironment,
} from "../../src/lib/health/worker-heartbeat";
import {
  CRITICAL_EVALUATION_MAINTENANCE_TASKS,
  runMaintenanceTask,
  runMaintenanceTasks,
} from "../../src/lib/health/maintenance-receipts";

async function healthyReviewer(db: ReturnType<typeof getDatabaseAdapter>) {
  const identity = {
    workerInstance: "review-probe",
    releaseSha: process.env.RADAR_RELEASE_SHA!,
    databaseFingerprint: getDatabaseTargetIdentity().fingerprint,
  };
  await db.execute("INSERT INTO worker_heartbeats VALUES('dossier-review',?,?,?,?)", [
    identity.workerInstance,
    identity.releaseSha,
    identity.databaseFingerprint,
    new Date().toISOString(),
  ]);
  await runMaintenanceTask(db, identity, "host_provider_checks", async () => undefined);
}

describe("release readiness", () => {
  const original = { ...process.env };

  afterEach(() => {
    resetDatabaseAdapter();
    process.env = { ...original };
  });
  it("requires evaluation and reviewer maintenance independently of outbound delivery", async () => {
    process.env.RADAR_ENV = "test";
    process.env.RADAR_RELEASE_SHA = "d".repeat(40);
    const db = getDatabaseAdapter();
    const fingerprint = getDatabaseTargetIdentity().fingerprint;
    await db.execute("DELETE FROM worker_heartbeats");
    expect((await getOperationsReadiness()).status).toBe(503);
    await db.execute("INSERT INTO worker_heartbeats VALUES('evaluation','probe',?,?,?)", [
      process.env.RADAR_RELEASE_SHA,
      fingerprint,
      new Date().toISOString(),
    ]);
    expect((await getOperationsReadiness()).status).toBe(503);
    for (const task of CRITICAL_EVALUATION_MAINTENANCE_TASKS) {
      await db.execute(
        `INSERT INTO operations_maintenance_tasks
         (worker_instance,task,release_sha,database_fingerprint,last_started_at,last_success_at,consecutive_failures,error_code)
         VALUES('probe',?,?,?,?,?,0,NULL)`,
        [task, process.env.RADAR_RELEASE_SHA, fingerprint, Date.now() - 1, Date.now()],
      );
    }
    expect((await getOperationsReadiness()).status).toBe(503);
    await healthyReviewer(db);
    expect((await getOperationsReadiness()).status).toBe(200);

    await db.execute(
      `UPDATE operations_maintenance_tasks SET last_started_at=?
       WHERE worker_instance='probe' AND task='notification_delivery'`,
      [Date.now()],
    );
    expect((await getOperationsReadiness()).status).toBe(200);

    await db.execute(
      `UPDATE operations_maintenance_tasks
       SET consecutive_failures=1,error_code='MAINTENANCE_TASK_FAILED'
       WHERE worker_instance='probe' AND task='notification_delivery'`,
    );
    expect((await getOperationsReadiness()).status).toBe(503);
    await db.execute(
      `UPDATE operations_maintenance_tasks
       SET consecutive_failures=0,error_code=NULL,last_success_at=?,last_started_at=?
       WHERE worker_instance='probe' AND task='notification_delivery'`,
      [Date.now() - 151_000, Date.now() - 151_000],
    );
    expect((await getOperationsReadiness()).status).toBe(503);
    for (const [sha, target, seen] of [
      ["old-release", fingerprint, new Date().toISOString()],
      [process.env.RADAR_RELEASE_SHA, "other-db", new Date().toISOString()],
      [process.env.RADAR_RELEASE_SHA, fingerprint, new Date(Date.now() - 151000).toISOString()],
    ]) {
      await db.execute(
        "UPDATE worker_heartbeats SET release_sha=?,database_fingerprint=?,last_seen_at=?",
        [sha, target, seen],
      );
      const response = await operationsReadyResponse();
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({
        status: "unavailable",
        releaseSha: process.env.RADAR_RELEASE_SHA,
      });
    }
  });

  it("records failed maintenance independently, then clears the failure after recovery", async () => {
    process.env.RADAR_ENV = "test";
    process.env.RADAR_RELEASE_SHA = "f".repeat(40);
    const db = getDatabaseAdapter();
    const identity = {
      workerInstance: "maintenance-failure-probe",
      releaseSha: "f".repeat(40),
      databaseFingerprint: getDatabaseTargetIdentity().fingerprint,
    };
    await healthyReviewer(db);
    await db.execute("DELETE FROM operations_maintenance_tasks WHERE worker_instance=?", [
      identity.workerInstance,
    ]);
    const fingerprint = getDatabaseTargetIdentity().fingerprint;
    const successfulAt = Date.now() - 1_000;
    await db.execute(
      `INSERT INTO worker_heartbeats(worker_name,instance_id,release_sha,database_fingerprint,last_seen_at)
       VALUES('evaluation',?,?,?,?)`,
      [identity.workerInstance, identity.releaseSha, fingerprint, new Date().toISOString()],
    );
    for (const task of CRITICAL_EVALUATION_MAINTENANCE_TASKS.slice(0, 5))
      await db.execute(
        `INSERT INTO operations_maintenance_tasks
         (worker_instance,task,release_sha,database_fingerprint,last_started_at,last_success_at,consecutive_failures,error_code)
         VALUES(?,?,?,?,?,?,0,NULL)`,
        [
          identity.workerInstance,
          task,
          identity.releaseSha,
          fingerprint,
          successfulAt,
          successfulAt,
        ],
      );
    let nextTaskRan = false;
    const results = await runMaintenanceTasks(db, identity, [
      {
        task: "incident_reconciliation",
        operation: async () => {
          throw new Error("INCIDENT_RECONCILIATION_FAILED");
        },
      },
      {
        task: "notification_delivery",
        operation: async () => {
          nextTaskRan = true;
        },
      },
    ]);
    expect(results).toMatchObject([
      {
        task: "incident_reconciliation",
        success: false,
        errorCode: "INCIDENT_RECONCILIATION_FAILED",
      },
      { task: "notification_delivery", success: true },
    ]);
    expect(nextTaskRan).toBe(true);
    expect((await getOperationsReadiness()).status).toBe(503);
    await expect(
      db.one<{
        consecutive_failures: number;
        error_code: string;
        last_success_at: number | null;
      }>(
        `SELECT consecutive_failures,error_code,last_success_at
         FROM operations_maintenance_tasks WHERE worker_instance=? AND task='incident_reconciliation'`,
        [identity.workerInstance],
      ),
    ).resolves.toMatchObject({
      consecutive_failures: 1,
      error_code: "INCIDENT_RECONCILIATION_FAILED",
      last_success_at: null,
    });
    await runMaintenanceTask(db, identity, "incident_reconciliation", async () => undefined);
    expect((await getOperationsReadiness()).status).toBe(200);
    await expect(
      db.one<{
        consecutive_failures: number;
        error_code: string | null;
        last_success_at: number | null;
      }>(
        `SELECT consecutive_failures,error_code,last_success_at
         FROM operations_maintenance_tasks WHERE worker_instance=? AND task='incident_reconciliation'`,
        [identity.workerInstance],
      ),
    ).resolves.toMatchObject({ consecutive_failures: 0, error_code: null });
  });

  it.each(["failed", "stale", "wrong-release", "wrong-database", "offline"])(
    "fails operations readiness for %s Google maintenance while evaluation is healthy",
    async (failure) => {
      process.env.RADAR_ENV = "test";
      process.env.RADAR_RELEASE_SHA = "google-maintenance-test";
      const db = getDatabaseAdapter();
      await db.execute("DELETE FROM worker_heartbeats");
      const identity = {
        workerInstance: "eval-probe",
        releaseSha: process.env.RADAR_RELEASE_SHA,
        databaseFingerprint: getDatabaseTargetIdentity().fingerprint,
      };
      await db.execute("INSERT INTO worker_heartbeats VALUES('evaluation',?,?,?,?)", [
        identity.workerInstance,
        identity.releaseSha,
        identity.databaseFingerprint,
        new Date().toISOString(),
      ]);
      for (const task of CRITICAL_EVALUATION_MAINTENANCE_TASKS)
        await runMaintenanceTask(db, identity, task, async () => undefined);
      await healthyReviewer(db);
      expect((await getOperationsReadiness()).status).toBe(200);
      if (failure === "failed")
        await db.execute(
          "UPDATE operations_maintenance_tasks SET consecutive_failures=1 WHERE worker_instance='review-probe'",
        );
      if (failure === "stale")
        await db.execute(
          "UPDATE operations_maintenance_tasks SET last_success_at=0 WHERE worker_instance='review-probe'",
        );
      if (failure === "wrong-release")
        await db.execute(
          "UPDATE operations_maintenance_tasks SET release_sha='old' WHERE worker_instance='review-probe'",
        );
      if (failure === "wrong-database")
        await db.execute(
          "UPDATE operations_maintenance_tasks SET database_fingerprint='other' WHERE worker_instance='review-probe'",
        );
      if (failure === "offline")
        await db.execute("DELETE FROM worker_heartbeats WHERE worker_name='dossier-review'");
      expect((await operationsReadyResponse()).status).toBe(503);
    },
  );

  it("fails closed without a reachable, verified database and exposes no target details", async () => {
    process.env.RADAR_RELEASE_SHA = "a".repeat(40);
    process.env.RADAR_ENV = "production";
    delete process.env.TURSO_CONNECTION_URL;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    const readiness = await getReadiness();
    expect(readiness).toEqual({
      status: 503,
      body: { status: "unavailable", releaseSha: "a".repeat(40) },
    });
    expect(JSON.stringify(readiness.body)).not.toMatch(/turso|token|candidate|person/i);
  });

  it("requires the app-host workers on the same release and database target", async () => {
    process.env.RADAR_ENV = "test";
    process.env.RADAR_RELEASE_SHA = "b".repeat(40);
    process.env.RADAR_SERVER_SCRAPER_ENABLED = "false";
    const db = getDatabaseAdapter();
    const fingerprint = getDatabaseTargetIdentity().fingerprint;
    const now = new Date().toISOString();
    const required = requiredWorkersForEnvironment();
    expect(required).not.toContain("scrape");
    for (const name of required) {
      await db.execute(
        `INSERT INTO worker_heartbeats (worker_name,instance_id,release_sha,database_fingerprint,last_seen_at)
         VALUES (?,?,?,?,?)`,
        [name, `${name}-test`, process.env.RADAR_RELEASE_SHA, fingerprint, now],
      );
    }
    await expect(getSystemReadiness()).resolves.toMatchObject({
      status: 200,
      body: {
        status: "ready",
        workers: {
          required: required.length,
          healthy: required.length,
          missing: [],
        },
      },
    });

    await db.execute("DELETE FROM worker_heartbeats WHERE worker_name = ?", ["corpus"]);
    await expect(getSystemReadiness()).resolves.toMatchObject({
      status: 503,
      body: { status: "unavailable", workers: { missing: ["corpus"] } },
    });
  });

  it("requires a scraper heartbeat only when server scraping is enabled", () => {
    const env = { RADAR_SERVER_SCRAPER_ENABLED: "true" } as NodeJS.ProcessEnv;
    expect(requiredWorkersForEnvironment(env)).toEqual(REQUIRED_WORKERS);
    env.RADAR_SERVER_SCRAPER_ENABLED = "false";
    expect(requiredWorkersForEnvironment(env)).not.toContain("scrape");
  });

  it("reports an evaluator online only for a fresh heartbeat on the same release and database", async () => {
    process.env.RADAR_ENV = "test";
    process.env.RADAR_RELEASE_SHA = "c".repeat(40);
    const db = getDatabaseAdapter();
    const fingerprint = getDatabaseTargetIdentity().fingerprint;
    const now = Date.now();

    await db.execute("DELETE FROM worker_heartbeats WHERE worker_name = ?", ["evaluation"]);
    await db.execute(
      `INSERT INTO worker_heartbeats (worker_name,instance_id,release_sha,database_fingerprint,last_seen_at)
       VALUES (?,?,?,?,?)`,
      [
        "evaluation",
        "evaluation-test",
        process.env.RADAR_RELEASE_SHA,
        fingerprint,
        new Date(now).toISOString(),
      ],
    );

    await expect(isWorkerOnline("evaluation", { db, now })).resolves.toBe(true);
    await expect(
      isWorkerOnline("evaluation", { db, now, releaseSha: "different-release" }),
    ).resolves.toBe(false);
    await expect(isWorkerOnline("evaluation", { db, now: now + 151_000 })).resolves.toBe(false);
  });
});
