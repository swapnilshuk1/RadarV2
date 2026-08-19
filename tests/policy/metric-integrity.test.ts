process.env.RADAR_USE_TURSO = "true";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDatabaseAdapter } from "../../src/data/database";
import {
  MetricIntegrityValidator,
  type CanonicalOpportunityMetrics,
} from "../../src/lib/intelligence/metric-integrity";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";

describe("RADAR V4 Phase 7.3 Fault Corpus & Integrity Test Matrix", { timeout: 30000 }, () => {
  const personId = "guest-user";
  const db = getDatabaseAdapter();

  beforeAll(async () => {
    await db.execute("DELETE FROM candidate_evaluations WHERE job_hash LIKE 'test_h_%'");
    await db.execute("DELETE FROM decisions WHERE opportunity_id LIKE 'test_i_%'");
  });

  afterAll(async () => {
    await db.execute("DELETE FROM candidate_evaluations WHERE job_hash LIKE 'test_h_%'");
    await db.execute("DELETE FROM decisions WHERE opportunity_id LIKE 'test_i_%'");
  });

  // CASE A: Correct canonical metrics
  it("CASE A — Valid Canonical Metrics pass integrity check clean", async () => {
    const validMetrics = await OpportunityService.getMetricsForUser("ms6i7e3y-4x0chy5fy");
    const integrity = await MetricIntegrityValidator.validate(validMetrics, db);
    if (integrity.status !== "PASS") {
      console.log("CASE A Discrepancies:", JSON.stringify(integrity.discrepancies, null, 2));
    }
    expect(integrity.status).toBe("PASS");
    expect(integrity.discrepancies.length).toBe(0);
  });

  // CASE B: Population mismatch
  it("CASE B — Population mismatch is detected as ERROR", async () => {
    const corruptMetrics: Omit<CanonicalOpportunityMetrics, "integrity"> = {
      personId,
      snapshotId: "snap_test_B",
      generatedAt: new Date().toISOString(),
      evaluationVersion: "v4.1",
      totalScreened: 100, // Deliberate discrepancy
      activePursuits: 156,
      totalShortlisted: 1234,
      totalDecisions: 0,
      remainingToReview: 100,
      engineBreakdown: { pursue: 156, consider: 1078, pass: 997, sparse: 0 },
      userBreakdown: { pursue: 0, consider: 0, pass: 0, total: 0 },
      effectiveBreakdown: { pursue: 156, consider: 1078, pass: 997, sparse: 0 },
    };

    const integrity = await MetricIntegrityValidator.validate(corruptMetrics, db);
    expect(integrity.status).toBe("ERROR");
    expect(integrity.discrepancies.some((d) => d.code === "CHECK_TOTAL_SCREENED")).toBe(true);
  });

  // CASE C: Recommendation distribution mismatch
  it("CASE C — Engine recommendation distribution mismatch is detected", async () => {
    const corruptDist: Omit<CanonicalOpportunityMetrics, "integrity"> = {
      personId,
      snapshotId: "snap_test_C",
      generatedAt: new Date().toISOString(),
      evaluationVersion: "v4.1",
      totalScreened: 2231,
      activePursuits: 156,
      totalShortlisted: 1234,
      totalDecisions: 0,
      remainingToReview: 2231,
      engineBreakdown: { pursue: 500, consider: 1078, pass: 997, sparse: 0 }, // Corrupt pursue count
      userBreakdown: { pursue: 0, consider: 0, pass: 0, total: 0 },
      effectiveBreakdown: { pursue: 156, consider: 1078, pass: 997, sparse: 0 },
    };

    const integrity = await MetricIntegrityValidator.validate(corruptDist, db);
    expect(integrity.status).toBe("ERROR");
    expect(integrity.discrepancies.some((d) => d.code === "CHECK_ENGINE_PURSUE")).toBe(true);
  });

  // CASE D: User decision mismatch
  it("CASE D — User decision mismatch is detected", async () => {
    const corruptUserDec: Omit<CanonicalOpportunityMetrics, "integrity"> = {
      personId,
      snapshotId: "snap_test_D",
      generatedAt: new Date().toISOString(),
      evaluationVersion: "v4.1",
      totalScreened: 2231,
      activePursuits: 156,
      totalShortlisted: 1234,
      totalDecisions: 50, // Corrupt decisions count
      remainingToReview: 2181,
      engineBreakdown: { pursue: 156, consider: 1078, pass: 997, sparse: 0 },
      userBreakdown: { pursue: 10, consider: 20, pass: 20, total: 50 },
      effectiveBreakdown: { pursue: 156, consider: 1078, pass: 997, sparse: 0 },
    };

    const integrity = await MetricIntegrityValidator.validate(corruptUserDec, db);
    expect(integrity.status).toBe("ERROR");
    expect(integrity.discrepancies.some((d) => d.code === "CHECK_TOTAL_DECISIONS")).toBe(true);
  });

  // CASE E: Mathematical invariant violation
  it("CASE E — Mathematical invariant violation (activePursuits > totalScreened) is caught", async () => {
    const invariantViolation: Omit<CanonicalOpportunityMetrics, "integrity"> = {
      personId,
      snapshotId: "snap_test_E",
      generatedAt: new Date().toISOString(),
      evaluationVersion: "v4.1",
      totalScreened: 2231,
      activePursuits: 3000, // Exceeds totalScreened
      totalShortlisted: 1234,
      totalDecisions: 0,
      remainingToReview: 2231,
      engineBreakdown: { pursue: 156, consider: 1078, pass: 997, sparse: 0 },
      userBreakdown: { pursue: 0, consider: 0, pass: 0, total: 0 },
      effectiveBreakdown: { pursue: 156, consider: 1078, pass: 997, sparse: 0 },
    };

    const integrity = await MetricIntegrityValidator.validate(invariantViolation, db);
    expect(integrity.status).toBe("ERROR");
    expect(integrity.discrepancies.some((d) => d.code === "INV_PURSUITS_LE_SCREENED")).toBe(true);
  });

  // CASE F: Validation query failure
  it("CASE F — Query verification failure returns UNAVAILABLE gracefully", async () => {
    const mockCorruptDb: any = {
      one: async () => {
        throw new Error("DB connection timeout");
      },
      many: async () => {
        throw new Error("DB connection timeout");
      },
    };

    const validMetrics: Omit<CanonicalOpportunityMetrics, "integrity"> = {
      personId,
      snapshotId: "snap_test_F",
      generatedAt: new Date().toISOString(),
      evaluationVersion: "v4.1",
      totalScreened: 2231,
      activePursuits: 156,
      totalShortlisted: 1234,
      totalDecisions: 0,
      remainingToReview: 2231,
      engineBreakdown: { pursue: 156, consider: 1078, pass: 997, sparse: 0 },
      userBreakdown: { pursue: 0, consider: 0, pass: 0, total: 0 },
      effectiveBreakdown: { pursue: 156, consider: 1078, pass: 997, sparse: 0 },
    };

    const integrity = await MetricIntegrityValidator.validate(validMetrics, mockCorruptDb);
    expect(integrity.status).toBe("UNAVAILABLE");
    expect(integrity.discrepancies[0].code).toBe("VERIFICATION_QUERY_FAILED");
  });

  // CASE G: Bounded feed smaller than population
  it("CASE G — Bounded feed length (100) does NOT influence global totalScreened (2231)", async () => {
    const feed = await OpportunityService.listForUser(personId);
    const metrics = await OpportunityService.getMetricsForUser(personId);

    expect(feed.length).toBe(100);
    expect(metrics.totalScreened).toBe(2231);
    expect(metrics.integrity.status).toBe("PASS");
  });

  // CASE H: Dynamic evaluation insertion updates population
  it("CASE H — Adding evaluation updates totalScreened correctly", async () => {
    const testHash = `test_h_${Date.now()}`;
    const initial = await OpportunityService.getMetricsForUser(personId);

    await db.execute(
      `INSERT INTO candidate_evaluations (person_id, job_hash, policy_version, evaluation_input_hash, engine_verdict, engine_quality_score, effective_decision, quality_score, evaluation_json, updated_at)
       VALUES (?, ?, 'v4.1', 'hash_test', 'PURSUE', 90, 'PURSUE', 90, '{}', CURRENT_TIMESTAMP)`,
      [personId, testHash]
    );

    const updated = await OpportunityService.getMetricsForUser(personId);
    expect(updated.totalScreened).toBe(initial.totalScreened + 1);

    await db.execute(`DELETE FROM candidate_evaluations WHERE job_hash = ?`, [testHash]);
  });

  // CASE I: User decision updates user metrics without changing engine metrics
  it("CASE I — User decision updates user state without mutating engine recommendation state", async () => {
    const testHash = `test_i_${Date.now()}`;
    const initial = await OpportunityService.getMetricsForUser(personId);

    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, reason, updated_at)
       VALUES (?, ?, 'PURSUE', 'Test decision', CURRENT_TIMESTAMP)`,
      [personId, testHash]
    );

    const updated = await OpportunityService.getMetricsForUser(personId);
    expect(updated.totalDecisions).toBe(initial.totalDecisions + 1);
    expect(updated.engineBreakdown.pursue).toBe(initial.engineBreakdown.pursue); // Engine metrics immutable

    await db.execute(`DELETE FROM decisions WHERE opportunity_id = ?`, [testHash]);
  });

  // CASE J: Intentional corruption through load path
  it("CASE J — Corrupt metrics snapshot triggers ERROR status and discrepancies array", async () => {
    const metrics = await OpportunityService.getMetricsForUser(personId);
    const corruptSnapshot: Omit<CanonicalOpportunityMetrics, "integrity"> = {
      ...metrics,
      activePursuits: 9999, // Intentional corruption
    };

    const integrity = await MetricIntegrityValidator.validate(corruptSnapshot, db);
    expect(integrity.status).toBe("ERROR");
    expect(integrity.discrepancies.length).toBeGreaterThan(0);
  });

  // CASE K: Validation unavailable through actual load path
  it("CASE K — Database query failure in loader path produces UNAVAILABLE integrity result", async () => {
    const metrics = await OpportunityService.getMetricsForUser(personId);
    const mockDbTimeout: any = {
      one: async () => {
        throw new Error("Turso query timeout");
      },
      many: async () => {
        throw new Error("Turso query timeout");
      },
    };

    const integrity = await MetricIntegrityValidator.validate(metrics, mockDbTimeout);
    expect(integrity.status).toBe("UNAVAILABLE");
    expect(integrity.discrepancies[0].message).toContain("Turso query timeout");
  });

  // CASE L: Cross-route metric consistency
  it("CASE L — Service returns uniform canonical metrics object across invocations", async () => {
    const metrics1 = await OpportunityService.getMetricsForUser(personId);
    const metrics2 = await OpportunityService.getMetricsForUser(personId);

    expect(metrics1.totalScreened).toBe(metrics2.totalScreened);
    expect(metrics1.activePursuits).toBe(metrics2.activePursuits);
    expect(metrics1.totalShortlisted).toBe(metrics2.totalShortlisted);
    expect(metrics1.integrity.status).toBe("PASS");
  });
});
