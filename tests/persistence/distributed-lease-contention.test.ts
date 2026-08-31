import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "./lineage_fixture";
import { EnrichmentQueue } from "../../scripts/scraper/persist/queue";
import { MemoryBlobStore, BlobStore } from "../../src/lib/storage/blob-store";

describe("Phase 4C: Distributed Execution, Payload Access & Lease Contention", () => {
  let db: SqliteAdapter;
  let sharedBlobStorage: BlobStore;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);

    // Shared remote object storage accessible by all distributed instances
    sharedBlobStorage = new MemoryBlobStore();
  });

  it("1. Distributed Contention Invariant: Instance B claims job, Instance C simultaneously NOT CLAIMED, B retrieves blob & completes", async () => {
    // ============================================================
    // INSTANCE A: Scraper / Ingestion Instance
    // ============================================================
    const instanceA_Queue = new EnrichmentQueue(db);
    const cardHash = "card_hash_contention_001";
    const payloadKey = `snapshots/${cardHash}.json`;

    const sampleCard = {
      cardHash,
      title: "Vice President of Enterprise Architecture",
      company: "Distributed Systems Global Corp",
      location: "San Francisco, CA (Hybrid)",
      detail: {
        rawText: "Lead multi-region cloud platform and distributed queue architectures.",
        qualifications: ["12+ years experience", "Distributed systems mastery"],
      },
    };

    // Instance A uploads payload to shared BlobStore and enqueues to Turso
    await sharedBlobStorage.put(payloadKey, JSON.stringify(sampleCard), "application/json");

    await instanceA_Queue.enqueue(
      "job-contention-001",
      cardHash,
      "/instance-a/local/snapshot.json", // Private to Instance A
      "v4.0.0",
      {
        runId: "run-distributed-test",
        executionPlanId: "plan-dist-1",
        definitionId: "def-dist-1",
        familyId: "fam-dist-1",
        portal: "LinkedIn",
        page: 1,
        catalogVersion: "1.0",
        plannerVersion: "1.0",
        ruleVersion: "1.0",
        searchQuery: "Enterprise Architecture",
      },
      10,
      0,
      payloadKey
    );

    // ============================================================
    // INSTANCE B & INSTANCE C: Race to Lease the Pending Job
    // ============================================================
    const instanceB_Queue = new EnrichmentQueue(db);
    const instanceC_Queue = new EnrichmentQueue(db);

    // Both instances race concurrently to lease the single available job
    const [leasedByB, leasedByC] = await Promise.all([
      instanceB_Queue.leaseJobs("worker_instance_b_node", 1),
      instanceC_Queue.leaseJobs("worker_instance_c_node", 1),
    ]);

    // MUTUAL EXCLUSION INVARIANT: Exactly one instance wins the lease!
    const bGotJob = leasedByB.length === 1;
    const cGotJob = leasedByC.length === 1;

    expect(bGotJob !== cGotJob).toBe(true); // XOR: exactly one winner
    expect(leasedByB.length + leasedByC.length).toBe(1);

    const winnerQueue = bGotJob ? instanceB_Queue : instanceC_Queue;
    const winnerJob = bGotJob ? leasedByB[0] : leasedByC[0];
    const loserQueue = bGotJob ? instanceC_Queue : instanceB_Queue;
    const loserWorkerId = bGotJob ? "worker_instance_c_node" : "worker_instance_b_node";

    // LOSER INVARIANT: Loser received zero jobs ("NOT CLAIMED")
    const loserJobs = bGotJob ? leasedByC : leasedByB;
    expect(loserJobs).toHaveLength(0);

    // Second attempt by loser while job is leased still returns 0 jobs
    const retryByLoser = await loserQueue.leaseJobs(loserWorkerId, 1);
    expect(retryByLoser).toHaveLength(0);

    // ============================================================
    // DISTRIBUTED PAYLOAD RETRIEVAL & COMPLETION
    // ============================================================
    // Winner retrieves payload strictly via BlobStore using payload_key
    const payloadBuffer = await sharedBlobStorage.get(winnerJob.payload_key);
    expect(payloadBuffer).not.toBeNull();

    const loadedCard = JSON.parse(payloadBuffer!.toString("utf-8"));
    expect(loadedCard.cardHash).toBe(cardHash);
    expect(loadedCard.title).toBe("Vice President of Enterprise Architecture");

    // Winner marks job running and complete
    await winnerQueue.markRunning(winnerJob.id);
    await winnerQueue.markCompleted(winnerJob.id);

    // After completion, loser attempts to lease again -> STILL 0 jobs (never double-processed)
    const postCompleteAttempt = await loserQueue.leaseJobs(loserWorkerId, 1);
    expect(postCompleteAttempt).toHaveLength(0);

    const stats = await winnerQueue.getRunStats("run-distributed-test");
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(0);
    expect(stats.pending).toBe(0);
  });

  it("2. Lease Expiry & Failover Invariant: Expired lease from crashed worker is stolen and completed by healthy instance", async () => {
    const instanceA_Queue = new EnrichmentQueue(db);
    const instanceB_Queue = new EnrichmentQueue(db);
    const instanceC_Queue = new EnrichmentQueue(db);

    const cardHash = "card_hash_failover_002";
    const payloadKey = `snapshots/${cardHash}.json`;

    await sharedBlobStorage.put(payloadKey, JSON.stringify({ cardHash, title: "Director of SRE" }), "application/json");

    await instanceA_Queue.enqueue(
      "job-failover-002",
      cardHash,
      "/instance-a/dummy.json",
      "v4.0.0",
      {
        runId: "run-failover-test",
        executionPlanId: "plan-failover-1",
        definitionId: "def-1",
        familyId: "fam-1",
        portal: "LinkedIn",
        page: 1,
        catalogVersion: "1.0",
        plannerVersion: "1.0",
        ruleVersion: "1.0",
        searchQuery: "SRE",
      },
      10,
      0,
      payloadKey
    );

    // Instance B leases the job with short duration
    const bLeased = await instanceB_Queue.leaseJobs("worker_instance_b_crashed", 1, 10);
    expect(bLeased).toHaveLength(1);

    // Simulate Instance B crashing and its lease expiring
    await db.execute(
      `UPDATE enrichment_jobs 
       SET lease_expires_at = datetime('now', '-30 seconds') 
       WHERE id = ?`,
      [bLeased[0].id]
    );

    // Instance C attempts to lease -> steals the expired lease
    const cLeased = await instanceC_Queue.leaseJobs("worker_instance_c_healthy", 1);
    expect(cLeased).toHaveLength(1);
    expect(cLeased[0].id).toBe(bLeased[0].id);
    expect(cLeased[0].lease_owner).toBe("worker_instance_c_healthy");

    // Instance C retrieves payload via BlobStore and completes
    const payload = await sharedBlobStorage.get(cLeased[0].payload_key);
    expect(payload).not.toBeNull();
    await instanceC_Queue.markCompleted(cLeased[0].id);

    const stats = await instanceC_Queue.getRunStats("run-failover-test");
    expect(stats.completed).toBe(1);
  });
});
