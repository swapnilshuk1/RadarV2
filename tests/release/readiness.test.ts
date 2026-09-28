import { afterEach, describe, expect, it } from "vitest";
import { getReadiness, getSystemReadiness } from "../../src/lib/health/readiness";
import {
  getDatabaseAdapter,
  getDatabaseTargetIdentity,
  resetDatabaseAdapter,
} from "../../src/data/database";
import { isWorkerOnline, REQUIRED_WORKERS } from "../../src/lib/health/worker-heartbeat";

describe("release readiness", () => {
  const original = { ...process.env };

  afterEach(() => {
    resetDatabaseAdapter();
    process.env = { ...original };
  });

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

  it("requires every core worker heartbeat on the same release and database target", async () => {
    process.env.RADAR_ENV = "test";
    process.env.RADAR_RELEASE_SHA = "b".repeat(40);
    const db = getDatabaseAdapter();
    const fingerprint = getDatabaseTargetIdentity().fingerprint;
    const now = new Date().toISOString();
    for (const name of REQUIRED_WORKERS) {
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
          required: REQUIRED_WORKERS.length,
          healthy: REQUIRED_WORKERS.length,
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
