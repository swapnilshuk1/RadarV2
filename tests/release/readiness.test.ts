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

describe("release readiness", () => {
  const original = { ...process.env };

  afterEach(() => {
    resetDatabaseAdapter();
    process.env = { ...original };
  });
  it("supports an external operations probe with no dependency on other workers or outbound delivery", async () => {
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
    expect((await getOperationsReadiness()).status).toBe(200);
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
