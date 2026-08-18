import { describe, it, expect, beforeEach } from "vitest";
import { getDatabaseAdapter } from "../src/data/database";
import { SqliteEvaluationStore } from "../src/data/sqlite/repositories/SqliteEvaluationStore";
import { MetricIntegrityValidator } from "../src/lib/intelligence/metric-integrity";

describe("RADAR V4 — Database Join Integrity & Deduplication Suite", () => {
  const db = getDatabaseAdapter();
  const repo = new SqliteEvaluationStore(db);

  beforeEach(async () => {
    // Ensure Schema exists

    // Initialize Schema individually using SqliteEvaluationStore.ensureSchema()
    await repo.saveEvaluation({
      personId: "setup_p",
      jobHash: "setup_j",
      policyVersion: "v4.1",
      evaluationInputHash: "hash_0",
      engineVerdict: "CONSIDER",
      engineQualityScore: 70,
      effectiveDecision: "CONSIDER",
      qualityScore: 70,
      evaluationStatus: "COMPLETE",
      evaluationJson: "{}"
    });

    // Clean up setup record
    await db.execute(`DELETE FROM candidate_evaluations WHERE person_id IN ('setup_p', 'p1', 'p2', 'p_test')`);
    await db.execute(`DELETE FROM decisions WHERE person_id IN ('setup_p', 'p1', 'p2', 'p_test')`);
  });

  it("1. Single evaluation + 1 decision => Exactly 1 active pursuit count", async () => {
    await repo.saveEvaluation({
      personId: "p1",
      jobHash: "job_1",
      policyVersion: "v4.1",
      evaluationInputHash: "hash_1",
      engineVerdict: "CONSIDER",
      engineQualityScore: 70,
      effectiveDecision: "CONSIDER",
      qualityScore: 70,
      evaluationStatus: "COMPLETE",
      evaluationJson: "{}"
    });

    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, reviewed_fingerprint, updated_at) VALUES ('p1', 'job_1', 'PURSUE', 'fp_1', '2026-08-17 10:00:00')
       ON CONFLICT(person_id, opportunity_id) DO UPDATE SET action=EXCLUDED.action, updated_at=EXCLUDED.updated_at`
    );

    const metrics = await repo.getEvaluationMetrics("p1");
    expect(metrics.totalScreened).toBe(1);
    expect(metrics.activePursuits).toBe(1);
    expect(metrics.decisionsCount).toBe(1);
  });

  it("2. Single evaluation + Upsert duplicate decisions => NO metric multiplication (count remains 1)", async () => {
    await repo.saveEvaluation({
      personId: "p2",
      jobHash: "job_2",
      policyVersion: "v4.1",
      evaluationInputHash: "hash_2",
      engineVerdict: "CONSIDER",
      engineQualityScore: 70,
      effectiveDecision: "CONSIDER",
      qualityScore: 70,
      evaluationStatus: "COMPLETE",
      evaluationJson: "{}"
    });

    // Upsert duplicate decisions
    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, updated_at) VALUES ('p2', 'job_2', 'PURSUE', '2026-08-17 10:00:00')
       ON CONFLICT(person_id, opportunity_id) DO UPDATE SET action=EXCLUDED.action, updated_at=EXCLUDED.updated_at`
    );
    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, updated_at) VALUES ('p2', 'job_2', 'PURSUE', '2026-08-17 10:01:00')
       ON CONFLICT(person_id, opportunity_id) DO UPDATE SET action=EXCLUDED.action, updated_at=EXCLUDED.updated_at`
    );

    const metrics = await repo.getEvaluationMetrics("p2");
    expect(metrics.totalScreened).toBe(1);
    expect(metrics.activePursuits).toBe(1);
    expect(metrics.decisionsCount).toBe(1);

    const fullMetrics = {
      personId: "p2",
      snapshotId: "snap_p2",
      generatedAt: new Date().toISOString(),
      evaluationVersion: "v4.1",
      totalScreened: metrics.totalScreened,
      activePursuits: metrics.activePursuits,
      totalShortlisted: metrics.shortlistedCount,
      totalDecisions: metrics.decisionsCount,
      remainingToReview: metrics.totalScreened - metrics.decisionsCount,
      engineBreakdown: { pursue: 0, consider: 1, pass: 0, sparse: 0, recommend_pursue: 0, recommend_consider: 0, recommend_pass: 0, total: 1 },
      userBreakdown: { pursue: 1, consider: 0, pass: 0, total: 1 },
      effectiveBreakdown: { pursue: 1, consider: 0, pass: 0, sparse: 0, recommend_pursue: 0, recommend_consider: 0, recommend_pass: 0, total: 1 },
      integrity: { status: "PASS", validatedAt: new Date().toISOString(), checks: [], discrepancies: [], summaryMessage: "OK", devDetails: { personId: "p2", totalChecked: 0, totalFailed: 0 } }
    };

    const validation = await MetricIntegrityValidator.validate(fullMetrics as any, db);
    expect(validation.status).toBe("PASS");
  });

  it("3. Single evaluation + Sequential CONTRADICTORY decisions (PURSUE -> CONSIDER -> PASS) => Latest timestamp (PASS) selected", async () => {
    await repo.saveEvaluation({
      personId: "p3",
      jobHash: "job_3",
      policyVersion: "v4.1",
      evaluationInputHash: "hash_3",
      engineVerdict: "CONSIDER",
      engineQualityScore: 70,
      effectiveDecision: "CONSIDER",
      qualityScore: 70,
      evaluationStatus: "COMPLETE",
      evaluationJson: "{}"
    });

    // Earliest: PURSUE
    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, updated_at) VALUES ('p3', 'job_3', 'PURSUE', '2026-08-17 10:00:00')
       ON CONFLICT(person_id, opportunity_id) DO UPDATE SET action=EXCLUDED.action, updated_at=EXCLUDED.updated_at`
    );
    // Middle: CONSIDER
    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, updated_at) VALUES ('p3', 'job_3', 'CONSIDER', '2026-08-17 10:05:00')
       ON CONFLICT(person_id, opportunity_id) DO UPDATE SET action=EXCLUDED.action, updated_at=EXCLUDED.updated_at`
    );
    // Latest: PASS
    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, updated_at) VALUES ('p3', 'job_3', 'PASS', '2026-08-17 10:10:00')
       ON CONFLICT(person_id, opportunity_id) DO UPDATE SET action=EXCLUDED.action, updated_at=EXCLUDED.updated_at`
    );

    const metrics = await repo.getEvaluationMetrics("p3");
    expect(metrics.totalScreened).toBe(1);
    expect(metrics.activePursuits).toBe(0);
    expect(metrics.decisionsCount).toBe(1);
  });

  it("4. Decision updates with different fingerprints => Selects latest fingerprint", async () => {
    await repo.saveEvaluation({
      personId: "p4",
      jobHash: "job_4",
      policyVersion: "v4.1",
      evaluationInputHash: "hash_4",
      engineVerdict: "CONSIDER",
      engineQualityScore: 70,
      effectiveDecision: "CONSIDER",
      qualityScore: 70,
      evaluationStatus: "COMPLETE",
      evaluationJson: "{}"
    });

    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, reviewed_fingerprint, updated_at) VALUES ('p4', 'job_4', 'CONSIDER', 'fp_old', '2026-08-17 09:00:00')
       ON CONFLICT(person_id, opportunity_id) DO UPDATE SET action=EXCLUDED.action, reviewed_fingerprint=EXCLUDED.reviewed_fingerprint, updated_at=EXCLUDED.updated_at`
    );
    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, reviewed_fingerprint, updated_at) VALUES ('p4', 'job_4', 'PURSUE', 'fp_latest', '2026-08-17 11:00:00')
       ON CONFLICT(person_id, opportunity_id) DO UPDATE SET action=EXCLUDED.action, reviewed_fingerprint=EXCLUDED.reviewed_fingerprint, updated_at=EXCLUDED.updated_at`
    );

    const metrics = await repo.getEvaluationMetrics("p4");
    expect(metrics.activePursuits).toBe(1);
  });

  it("5. Multiple evaluations + multiple candidates => Isolation across person_id and job_hash", async () => {
    await repo.saveEvaluation({
      personId: "p_iso1",
      jobHash: "job_iso1",
      policyVersion: "v4.1",
      evaluationInputHash: "hash_1",
      engineVerdict: "CONSIDER",
      engineQualityScore: 70,
      effectiveDecision: "CONSIDER",
      qualityScore: 70,
      evaluationStatus: "COMPLETE",
      evaluationJson: "{}"
    });
    await repo.saveEvaluation({
      personId: "p_iso1",
      jobHash: "job_iso2",
      policyVersion: "v4.1",
      evaluationInputHash: "hash_2",
      engineVerdict: "PURSUE",
      engineQualityScore: 85,
      effectiveDecision: "PURSUE",
      qualityScore: 85,
      evaluationStatus: "COMPLETE",
      evaluationJson: "{}"
    });
    await repo.saveEvaluation({
      personId: "p_iso2",
      jobHash: "job_iso1",
      policyVersion: "v4.1",
      evaluationInputHash: "hash_3",
      engineVerdict: "PASS",
      engineQualityScore: 30,
      effectiveDecision: "PASS",
      qualityScore: 30,
      evaluationStatus: "COMPLETE",
      evaluationJson: "{}"
    });

    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, updated_at) VALUES ('p_iso1', 'job_iso1', 'PURSUE', '2026-08-17 10:00:00')
       ON CONFLICT(person_id, opportunity_id) DO UPDATE SET action=EXCLUDED.action, updated_at=EXCLUDED.updated_at`
    );
    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, updated_at) VALUES ('p_iso2', 'job_iso1', 'PURSUE', '2026-08-17 10:00:00')
       ON CONFLICT(person_id, opportunity_id) DO UPDATE SET action=EXCLUDED.action, updated_at=EXCLUDED.updated_at`
    );

    const p1Metrics = await repo.getEvaluationMetrics("p_iso1");
    expect(p1Metrics.totalScreened).toBe(2);
    expect(p1Metrics.activePursuits).toBe(2);

    const p2Metrics = await repo.getEvaluationMetrics("p_iso2");
    expect(p2Metrics.totalScreened).toBe(1);
    expect(p2Metrics.activePursuits).toBe(1);

    await db.execute(`DELETE FROM decisions WHERE person_id IN ('p_iso1', 'p_iso2')`);
  });
});
