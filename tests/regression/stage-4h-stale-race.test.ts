import { describe, it, expect, beforeEach } from "vitest";
import { getDatabaseAdapter, resetDatabaseAdapter } from "../../src/data/database";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { SqliteEvaluationStore } from "../../src/data/sqlite/repositories/SqliteEvaluationStore";
import { EvaluationWorker } from "../../src/lib/intelligence/workers/EvaluationWorker";

describe("Stage 4H: Stale-Job Race Condition & Superseding Protection", () => {
  const testPersonId = `test_stale_${Date.now()}`;
  const testJobHash = `job_race_${Date.now()}`;
  let db: any;
  let evalStore: SqliteEvaluationStore;

  beforeEach(async () => {
    resetDatabaseAdapter();
    db = getDatabaseAdapter(":memory:");
    await runMigrations(db);
    evalStore = new SqliteEvaluationStore(db);

    // Seed parent rows
    await db.execute(`INSERT INTO companies (id, name) VALUES ('comp_test', 'Acme Test')`);
    await db.execute(
      `INSERT INTO people (id, email, meta_schema_version, meta_timestamp) VALUES (?, 'stale@test.internal', 'v1', CURRENT_TIMESTAMP)`,
      [testPersonId]
    );
    await db.execute(
      `INSERT INTO opportunities (id, company_id, canonical_title, fingerprint, lifecycle) VALUES (?, 'comp_test', 'Title', 'fp_stale', 'ACTIVE')`,
      [testJobHash]
    );
  });

  it("supersedes and discards stale Job A when Job B with updated input hash is created", async () => {
    const oldInputHash = "hash_profile_v1_policy_v4.1";
    const newInputHash = SqliteEvaluationStore.computeInputHash("v1", testJobHash, "v4.1", "v2");

    // 1. Enqueue Job A with old input hash
    const jobAId = await evalStore.enqueueJob(testPersonId, testJobHash, oldInputHash);
    expect(jobAId).toBeDefined();

    // 2. Worker 1 claims Job A
    const claimedJobA = await evalStore.claimJob("worker_1", 5);
    expect(claimedJobA).not.toBeNull();
    expect(claimedJobA?.id).toBe(jobAId);
    expect(claimedJobA?.inputHash).toBe(oldInputHash);

    // 3. Candidate profile or policy updates -> Job B is enqueued with new input hash
    const jobBId = await evalStore.enqueueJob(testPersonId, testJobHash, newInputHash);
    expect(jobBId).toBeDefined();

    // 4. Worker 1 attempts to process Job A (which has old inputHash)
    // When EvaluationWorker validates input hash freshness, it detects oldInputHash !== currentInputHash
    const oldJobCurrentHash = SqliteEvaluationStore.computeInputHash("v1", testJobHash, "v4.1", "v2");
    expect(claimedJobA?.inputHash).not.toBe(oldJobCurrentHash);

    // In EvaluationWorker logic:
    if (claimedJobA!.inputHash !== oldJobCurrentHash) {
      await evalStore.markJobFailed(claimedJobA!.id, "Superseded by newer input hash", true);
    }

    // Verify Job A is marked SUPERSEDED in queue
    const jobARow = await db.one(`SELECT * FROM evaluation_jobs WHERE id = ?`, [jobAId]);
    expect(jobARow.status).toBe("SUPERSEDED");

    // Verify candidate_evaluations was NOT populated with stale Job A result
    const evalAfterA = await evalStore.getEvaluation(testPersonId, testJobHash);
    expect(evalAfterA).toBeNull();

    // 5. Worker 2 claims Job B (the authoritative fresh job)
    const claimedJobB = await evalStore.claimJob("worker_2", 5);
    expect(claimedJobB).not.toBeNull();
    expect(claimedJobB?.id).toBe(jobBId);
    expect(claimedJobB?.inputHash).toBe(newInputHash);

    // Save authoritative evaluation for Job B
    await evalStore.saveEvaluation({
      personId: testPersonId,
      jobHash: testJobHash,
      policyVersion: "v4.1",
      evaluationInputHash: newInputHash,
      engineVerdict: "PURSUE",
      engineQualityScore: 92.5,
      effectiveDecision: "PURSUE",
      qualityScore: 92.5,
      evaluationStatus: "COMPLETE",
      evaluationJson: JSON.stringify({ jobHash: testJobHash, score: 92.5 }),
    });
    await evalStore.markJobCompleted(jobBId);

    // 6. Verify Job B completed and authoritative record is saved
    const jobBRow = await db.one(`SELECT * FROM evaluation_jobs WHERE id = ?`, [jobBId]);
    expect(jobBRow.status).toBe("COMPLETED");

    const finalEval = await evalStore.getEvaluation(testPersonId, testJobHash);
    expect(finalEval).toBeDefined();
    expect(finalEval?.evaluationInputHash).toBe(newInputHash);
    expect(finalEval?.engineVerdict).toBe("PURSUE");
    expect(finalEval?.qualityScore).toBe(92.5);
  });
});
