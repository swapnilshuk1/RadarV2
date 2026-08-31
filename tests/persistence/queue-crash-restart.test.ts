import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { EnrichmentQueue } from "../../scripts/scraper/persist/queue";

describe("Checkpoint C: Turso Operational Queue State Plane & Crash/Restart Invariants", () => {
  let sqliteDb: Database.Database;
  let adapter: SqliteAdapter;
  let queue: EnrichmentQueue;

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    adapter = new SqliteAdapter(sqliteDb);
    await runMigrations(adapter);
    queue = new EnrichmentQueue(adapter);
  });

  it("Invariant 1: Idempotent Enqueue — Duplicate job_hash never creates duplicate work", async () => {
    const provenance = {
      runId: "run_test_1",
      executionPlanId: "plan_1",
      definitionId: "def_1",
      familyId: "fam_1",
      portal: "LinkedIn",
      page: 1,
      catalogVersion: "1.0",
      plannerVersion: "1.0",
      ruleVersion: "1.0",
      searchQuery: "Chief Growth Officer",
    };

    const first = await queue.enqueue(
      "card_unit_1",
      "hash_unique_abc123",
      "artifacts/snapshots/snap_1.json",
      "ext_v2",
      provenance,
      10,
      5
    );
    expect(first).toBe(true);

    // Duplicate enqueue with identical jobHash
    const second = await queue.enqueue(
      "card_unit_1_dup",
      "hash_unique_abc123",
      "artifacts/snapshots/snap_1_dup.json",
      "ext_v2",
      provenance,
      10,
      5
    );
    expect(second).toBe(false);

    // Assert only 1 job exists in the queue
    const count = await adapter.one<{ c: number }>("SELECT COUNT(*) as c FROM enrichment_jobs");
    expect(count?.c).toBe(1);
  });

  it("Invariant 2: Priority Ordering — Highest business + execution priority leased first", async () => {
    const baseProv = {
      runId: "run_prio",
      executionPlanId: "plan_prio",
      definitionId: "def_prio",
      familyId: "fam_prio",
      portal: "LinkedIn",
      page: 1,
      catalogVersion: "1.0",
      plannerVersion: "1.0",
      ruleVersion: "1.0",
      searchQuery: "Executive",
    };

    // Low priority (total 2)
    await queue.enqueue("card_low", "hash_low", "snap_low.json", "ext_v2", baseProv, 1, 1);
    // High priority (total 20)
    await queue.enqueue("card_high", "hash_high", "snap_high.json", "ext_v2", baseProv, 15, 5);
    // Medium priority (total 10)
    await queue.enqueue("card_med", "hash_med", "snap_med.json", "ext_v2", baseProv, 8, 2);

    const leased = await queue.leaseJobs("worker_prio", 1);
    expect(leased.length).toBe(1);
    expect(leased[0].id).toBe("card_high");
    expect(leased[0].job_hash).toBe("hash_high");
  });

  it("Invariant 3: Concurrent Claim Exclusion — Two workers cannot lease the same jobs", async () => {
    const baseProv = {
      runId: "run_concurrent",
      executionPlanId: "plan_c",
      definitionId: "def_c",
      familyId: "fam_c",
      portal: "Naukri",
      page: 1,
      catalogVersion: "1.0",
      plannerVersion: "1.0",
      ruleVersion: "1.0",
      searchQuery: "Director",
    };

    await queue.enqueue("job_c1", "hash_c1", "snap_c1.json", "ext_v2", baseProv, 5, 0);
    await queue.enqueue("job_c2", "hash_c2", "snap_c2.json", "ext_v2", baseProv, 5, 0);

    const workerA = new EnrichmentQueue(adapter);
    const workerB = new EnrichmentQueue(adapter);

    const batchA = await workerA.leaseJobs("worker_A", 1);
    const batchB = await workerB.leaseJobs("worker_B", 1);

    expect(batchA.length).toBe(1);
    expect(batchB.length).toBe(1);
    expect(batchA[0].id).not.toBe(batchB[0].id);

    // Mutual exclusion: no third worker can lease anything since batch is leased
    const workerC = new EnrichmentQueue(adapter);
    const batchC = await workerC.leaseJobs("worker_C", 5);
    expect(batchC.length).toBe(0);
  });

  it("Invariant 4: Crash/Restart & Stale Lease Recovery — In-flight work survives worker death", async () => {
    const baseProv = {
      runId: "run_crash_recovery",
      executionPlanId: "plan_cr",
      definitionId: "def_cr",
      familyId: "fam_cr",
      portal: "LinkedIn",
      page: 1,
      catalogVersion: "1.0",
      plannerVersion: "1.0",
      ruleVersion: "1.0",
      searchQuery: "Chief Executive Officer",
    };

    // 1. Enqueue job
    await queue.enqueue("job_crash_1", "hash_crash_1", "snap_crash_1.json", "ext_v2", baseProv, 10, 0);

    // 2. Worker 1 leases job with 1-second lease
    const worker1 = new EnrichmentQueue(adapter);
    const [leasedJob] = await worker1.leaseJobs("worker_1", 1, 1);
    expect(leasedJob).toBeDefined();
    expect(leasedJob.status).toBe("LEASED");

    // Worker 1 marks job RUNNING
    await worker1.markRunning(leasedJob.id);
    const runningRow = await adapter.one<{ status: string; started_at: string }>(
      "SELECT status, started_at FROM enrichment_jobs WHERE id = ?",
      [leasedJob.id]
    );
    expect(runningRow?.status).toBe("RUNNING");
    expect(runningRow?.started_at).toBeDefined();

    // 3. Worker 1 abruptly crashes! (Simulate lease expiration into past)
    await adapter.execute(
      "UPDATE enrichment_jobs SET lease_expires_at = datetime('now', '-10 seconds') WHERE id = ?",
      [leasedJob.id]
    );

    // 4. Worker 2 boots up (process restart) and invokes recoverExpiredLeases()
    const worker2 = new EnrichmentQueue(adapter);
    const recoveredCount = await worker2.recoverExpiredLeases();
    expect(recoveredCount).toBe(1);

    // Verify job returned to PENDING with audit explanation and lease cleared
    const recoveredJob = await adapter.one<{ status: string; lease_owner: string | null; last_error: string }>(
      "SELECT status, lease_owner, last_error FROM enrichment_jobs WHERE id = ?",
      [leasedJob.id]
    );
    expect(recoveredJob?.status).toBe("PENDING");
    expect(recoveredJob?.lease_owner).toBeNull();
    expect(recoveredJob?.last_error).toContain("Lease expired / worker reclaimed job");

    // 5. Worker 2 re-leases and completes the job successfully
    const reLeased = await worker2.leaseJobs("worker_2", 1);
    expect(reLeased.length).toBe(1);
    expect(reLeased[0].id).toBe("job_crash_1");

    await worker2.markCompleted(reLeased[0].id);

    const completedRow = await adapter.one<{ status: string; completed_at: string }>(
      "SELECT status, completed_at FROM enrichment_jobs WHERE id = ?",
      [leasedJob.id]
    );
    expect(completedRow?.status).toBe("COMPLETE");
    expect(completedRow?.completed_at).toBeDefined();

    // Verify zero lost jobs and zero duplicates
    const totalCount = await adapter.one<{ c: number }>("SELECT COUNT(*) as c FROM enrichment_jobs");
    expect(totalCount?.c).toBe(1);
  });

  it("Invariant 5: Retry Cooling Down & Terminal Failure Lifecycle", async () => {
    const baseProv = {
      runId: "run_retry_test",
      executionPlanId: "plan_rt",
      definitionId: "def_rt",
      familyId: "fam_rt",
      portal: "Naukri",
      page: 1,
      catalogVersion: "1.0",
      plannerVersion: "1.0",
      ruleVersion: "1.0",
      searchQuery: "VP Engineering",
    };

    await queue.enqueue("job_retry_1", "hash_retry_1", "snap_retry_1.json", "ext_v2", baseProv, 10, 0);

    const [job] = await queue.leaseJobs("worker_retry", 1);
    expect(job).toBeDefined();

    // Schedule retry with future next_retry_at (10 minutes in future)
    const futureTime = new Date(Date.now() + 600000).toISOString();
    await queue.markRetry(job.id, "RATE_LIMIT", "HTTP 429 Too Many Requests", futureTime);

    // Job should NOT be claimable while cooling down
    const available = await queue.leaseJobs("worker_retry_2", 1);
    expect(available.length).toBe(0);

    // Fast-forward cooldown into past
    await adapter.execute(
      "UPDATE enrichment_jobs SET next_retry_at = datetime('now', '-5 seconds') WHERE id = ?",
      [job.id]
    );

    // Now job becomes claimable
    const reLeased = await queue.leaseJobs("worker_retry_2", 1);
    expect(reLeased.length).toBe(1);
    expect(reLeased[0].attempts).toBe(1);

    // Mark fatal failure
    await queue.markFailed(job.id, "UNKNOWN", "Permanent 404 JD Not Found");
    const failedJob = await adapter.one<{ status: string; failure_type: string; attempts: number }>(
      "SELECT status, failure_type, attempts FROM enrichment_jobs WHERE id = ?",
      [job.id]
    );
    expect(failedJob?.status).toBe("FAILED");
    expect(failedJob?.failure_type).toBe("UNKNOWN");
    expect(failedJob?.attempts).toBe(2);
  });

  it("Invariant 6: Telemetry & Run-Scoped Progress Queries", async () => {
    const runId = "run_telemetry_test";
    const baseProv = {
      runId,
      executionPlanId: "plan_t",
      definitionId: "def_t",
      familyId: "fam_t",
      portal: "Indeed",
      page: 1,
      catalogVersion: "1.0",
      plannerVersion: "1.0",
      ruleVersion: "1.0",
      searchQuery: "COO",
    };

    await queue.enqueue("job_t1", "hash_t1", "snap_t1.json", "ext_v2", baseProv, 5, 0);
    await queue.enqueue("job_t2", "hash_t2", "snap_t2.json", "ext_v2", baseProv, 5, 0);

    let stats = await queue.getRunStats(runId);
    expect(stats.total).toBe(2);
    expect(stats.pending).toBe(2);
    expect(stats.completed).toBe(0);

    const [j1] = await queue.leaseJobsForRun("worker_t", runId, 1);
    await queue.markCompleted(j1.id);

    stats = await queue.getRunStats(runId);
    expect(stats.completed).toBe(1);
    expect(stats.pending).toBe(1);

    const globalStats = await queue.getGlobalPipelineStats();
    expect(globalStats.completed).toBe(1);
    expect(globalStats.pending).toBe(1);
  });

  it("Invariant 7: Mechanical Enforcement — No production code opens .radar/queue.db or imports better-sqlite3 in queue", async () => {
    // 1. Assert .radar/queue.db does not exist
    const queueDbPath = path.join(process.cwd(), ".radar", "queue.db");
    expect(fs.existsSync(queueDbPath)).toBe(false);

    // 2. Assert scripts/scraper/persist/queue.ts does NOT import better-sqlite3
    const queueSource = fs.readFileSync(
      path.join(process.cwd(), "scripts", "scraper", "persist", "queue.ts"),
      "utf-8"
    );
    expect(queueSource.includes("better-sqlite3")).toBe(false);
    expect(queueSource.includes("Database(")).toBe(false);
    expect(queueSource.includes(".radar")).toBe(false);
  });
});
