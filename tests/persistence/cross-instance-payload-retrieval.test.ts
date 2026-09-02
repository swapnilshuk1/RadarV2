import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "./lineage_fixture";
import { EnrichmentQueue } from "../../scripts/scraper/persist/queue";
import { MemoryBlobStore, BlobStore } from "../../src/lib/storage/blob-store";

describe("Phase 4B: Cross-Instance Payload Retrieval & BlobStore Invariant", () => {
  let db: SqliteAdapter;
  let sharedObjectStorage: BlobStore;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);

    // Shared remote object store (e.g., S3/R2 simulation accessible over network by all instances)
    sharedObjectStorage = new MemoryBlobStore();
  });

  it("1. Decisive Invariant: Instance A writes blob, Instance B on isolated disk leases and retrieves identical payload", async () => {
    // ==========================================
    // INSTANCE A (Scraper / Ingestion Instance)
    // ==========================================
    // Instance A has its own isolated queue client
    const instanceA_Queue = new EnrichmentQueue(db);
    const cardHash = "card_hash_cross_instance_001";
    const payloadKey = `snapshots/${cardHash}.json`;

    const sampleDetailedCard = {
      cardHash,
      title: "Chief Product & Technology Officer",
      company: "Acme Global Technologies",
      location: "Bengaluru (Hybrid)",
      detail: {
        rawText: "Lead full engineering and product organizations. P&L scale 100M+ ARR.",
        qualifications: ["15+ years experience", "VP or CXO level"],
      },
    };

    // Instance A puts the payload into shared object storage
    await sharedObjectStorage.put(payloadKey, JSON.stringify(sampleDetailedCard), "application/json");

    // Instance A enqueues job into Turso Cloud with durable payload_key.
    // Note: snapshotPath is set to a path on Instance A's private local disk that does NOT exist on Instance B!
    const instanceA_privateDiskSnapshot = "/var/containers/instance-a/private/snapshot-001.json";
    const enqueued = await instanceA_Queue.enqueue(
      "unit-job-001",
      cardHash,
      instanceA_privateDiskSnapshot,
      "v4.0.0",
      {
        runId: "run-cross-instance-test",
        executionPlanId: "plan-unit-1",
        definitionId: "def-1",
        familyId: "fam-1",
        portal: "LinkedIn",
        page: 1,
        catalogVersion: "1.0",
        plannerVersion: "1.0",
        ruleVersion: "1.0",
        searchQuery: "CPTO",
      },
      10,
      0,
      payloadKey // Explicit durable payload_key in Turso!
    );
    expect(enqueued).toBe(true);

    // ==========================================
    // INSTANCE B (Remote Enrichment Worker Node)
    // ==========================================
    // Instance B has zero access to Instance A's container disk filesystem
    const instanceB_Queue = new EnrichmentQueue(db);
    const leasedJobs = await instanceB_Queue.leaseJobs("worker_instance_b_node_99", 1);
    expect(leasedJobs).toHaveLength(1);

    const leasedJob = leasedJobs[0];
    expect(leasedJob.job_hash).toBe(cardHash);
    expect(leasedJob.payload_key).toBe(payloadKey);

    // Instance B retrieves the payload strictly using the durable payload_key from shared object storage
    const retrievedBuffer = await sharedObjectStorage.get(leasedJob.payload_key);
    expect(retrievedBuffer).not.toBeNull();

    const parsedCard = JSON.parse(retrievedBuffer!.toString("utf-8"));
    expect(parsedCard.cardHash).toBe(cardHash);
    expect(parsedCard.title).toBe("Chief Product & Technology Officer");
    expect(parsedCard.company).toBe("Acme Global Technologies");
    expect(parsedCard.detail.rawText).toContain("P&L scale 100M+ ARR");

    // Instance B marks job running and complete
    await instanceB_Queue.markRunning(leasedJob.id);
    await instanceB_Queue.markCompleted(leasedJob.id);

    const stats = await instanceB_Queue.getRunStats("run-cross-instance-test");
    expect(stats.completed).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it("2. Failure Semantics: missing blob payload fails gracefully and preserves queue health", async () => {
    const queue = new EnrichmentQueue(db);
    const missingHash = "card_hash_orphaned_999";
    const missingKey = `snapshots/${missingHash}.json`;

    // Enqueue job pointing to nonexistent blob
    await queue.enqueue(
      "unit-job-missing",
      missingHash,
      "dummy_path.json",
      "v4.0.0",
      {
        runId: "run-missing-test",
        executionPlanId: "plan-missing-1",
        definitionId: "def-1",
        familyId: "fam-1",
        portal: "LinkedIn",
        page: 1,
        catalogVersion: "1.0",
        plannerVersion: "1.0",
        ruleVersion: "1.0",
        searchQuery: "VP",
      },
      10,
      0,
      missingKey
    );

    const leased = await queue.leaseJobs("worker_instance_b", 1);
    expect(leased).toHaveLength(1);

    const payload = await sharedObjectStorage.get(leased[0].payload_key);
    expect(payload).toBeNull(); // Missing in storage!

    // Worker records failure gracefully
    await queue.markFailed(
      leased[0].id,
      "UNKNOWN",
      `Orphaned payload: Blob ${leased[0].payload_key} missing in BlobStore`
    );

    const stats = await queue.getRunStats("run-missing-test");
    expect(stats.failed).toBe(1);
    expect(stats.completed).toBe(0);
  });
});
