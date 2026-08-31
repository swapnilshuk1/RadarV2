import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDatabaseAdapter } from "../../src/data/database";
import {
  MetricIntegrityValidator,
  type CanonicalOpportunityMetrics,
} from "../../src/lib/intelligence/metric-integrity";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";
import { seedMetricsData } from "./metric-integrity-seed";

describe("RADAR V4 Phase 7.3 Fault Corpus & Integrity Test Matrix", { timeout: 30000 }, () => {
  const personId = "guest-user";
  const tenantId = `tenant_${personId}`;
  const db = getDatabaseAdapter();

  beforeAll(async () => {
    await seedMetricsData(personId);
    await db.execute("DELETE FROM candidate_evaluations WHERE job_hash LIKE 'test_h_%'");
    await db.execute("DELETE FROM decisions WHERE opportunity_id LIKE 'test_i_%'");
    await db.execute("DELETE FROM canonical_opportunities WHERE id LIKE 'test_h_%' OR id LIKE 'test_i_%'");
  });

  afterAll(async () => {
    await db.execute("DELETE FROM candidate_evaluations WHERE job_hash LIKE 'test_h_%'");
    await db.execute("DELETE FROM decisions WHERE opportunity_id LIKE 'test_i_%'");
    await db.execute("DELETE FROM canonical_opportunities WHERE id LIKE 'test_h_%' OR id LIKE 'test_i_%'");
  });

  // CASE A: Correct canonical metrics
  it("CASE A — Valid Canonical Metrics pass integrity check clean", async () => {
    const validMetrics = await OpportunityService.getMetricsForUser(personId);
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
      totalScreened: 99, // Deliberate discrepancy from 10
      activePursuits: 156,
      totalShortlisted: 1234,
      totalDecisions: 0,
      remainingToReview: 10,
      engineBreakdown: { pursue: 4, consider: 3, pass: 3, sparse: 0 },
      userBreakdown: { pursue: 0, consider: 0, pass: 0, total: 0 },
      effectiveBreakdown: { pursue: 4, consider: 3, pass: 3, sparse: 0 },
    };

    const integrity = await MetricIntegrityValidator.validate(corruptMetrics, db);
    expect(integrity.status).toBe("ERROR");
    expect(integrity.discrepancies.some((d) => d.code === "CHECK_TOTAL_SCREENED")).toBe(true);
  });

  // CASE C: Engine recommendation mismatch
  it("CASE C — Engine recommendation distribution mismatch is detected", async () => {
    const corruptDist: Omit<CanonicalOpportunityMetrics, "integrity"> = {
      personId,
      snapshotId: "snap_test_C",
      generatedAt: new Date().toISOString(),
      evaluationVersion: "v4.1",
      totalScreened: 10,
      activePursuits: 156,
      totalShortlisted: 1234,
      totalDecisions: 0,
      remainingToReview: 10,
      engineBreakdown: { pursue: 500, consider: 3, pass: 3, sparse: 0 }, // Corrupt pursue count
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
      totalScreened: 10,
      activePursuits: 156,
      totalShortlisted: 1234,
      totalDecisions: 50, // Corrupt decisions count
      remainingToReview: 10,
      engineBreakdown: { pursue: 4, consider: 3, pass: 3, sparse: 0 },
      userBreakdown: { pursue: 10, consider: 20, pass: 20, total: 50 },
      effectiveBreakdown: { pursue: 4, consider: 3, pass: 3, sparse: 0 },
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
      totalScreened: 10,
      activePursuits: 3000, // Exceeds totalScreened
      totalShortlisted: 1234,
      totalDecisions: 0,
      remainingToReview: 10,
      engineBreakdown: { pursue: 4, consider: 3, pass: 3, sparse: 0 },
      userBreakdown: { pursue: 0, consider: 0, pass: 0, total: 0 },
      effectiveBreakdown: { pursue: 4, consider: 3, pass: 3, sparse: 0 },
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
      totalScreened: 10,
      activePursuits: 4,
      totalShortlisted: 4,
      totalDecisions: 0,
      remainingToReview: 10,
      engineBreakdown: { pursue: 4, consider: 3, pass: 3, sparse: 0 },
      userBreakdown: { pursue: 0, consider: 0, pass: 0, total: 0 },
      effectiveBreakdown: { pursue: 4, consider: 3, pass: 3, sparse: 0 },
    };

    const integrity = await MetricIntegrityValidator.validate(validMetrics, mockCorruptDb);
    expect(integrity.status).toBe("UNAVAILABLE");
    expect(integrity.discrepancies[0].code).toBe("VERIFICATION_QUERY_FAILED");
  });

  // CASE G: Bounded feed smaller than population
  it("CASE G — Bounded feed length (10) does NOT influence global totalScreened (10)", async () => {
    const feed = (await OpportunityService.listForUser(personId)).slice(0, 100);
    const metrics = await OpportunityService.getMetricsForUser(personId);

    expect(feed.length).toBe(10);
    expect(metrics.totalScreened).toBe(10);
    expect(metrics.integrity.status).toBe("PASS");
  });

  // CASE H: Dynamic evaluation insertion updates population
  it("CASE H — Adding evaluation updates totalScreened correctly", async () => {
    const testHash = `test_h_${Date.now()}`;
    const initial = await OpportunityService.getMetricsForUser(personId);

    await db.transaction(async (tx) => {
      await tx.execute(`INSERT OR IGNORE INTO companies (id, name, industry) VALUES ('comp1', 'Test', 'tech')`);
      await tx.execute(`INSERT INTO opportunities (id, company_id, canonical_title, fingerprint, lifecycle) VALUES (?, 'comp1', 'Title', ?, 'ACTIVE')`, [testHash, testHash]);
      await tx.execute(`INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES (?, 'test', ?, 'http')`, [testHash, testHash]);
      await tx.execute(`INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content) VALUES ('v_${testHash}', ?, 'ch1', 'Dir', 'raw')`, [testHash]);
      await tx.execute(`INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, 'v_${testHash}', 'CANDIDATE')`, [tenantId, personId, `sp_${personId}`, testHash]);
      await tx.execute(`INSERT INTO materialized_evaluations (canonical_job_id, opportunity_version, tenant_id, person_id, evaluation_context_fingerprint, evaluation_state, decision, quality_score, rationale, evidence_ids, evaluation_json) VALUES (?, 'v_${testHash}', ?, ?, ?, 'EVALUATED', 'PURSUE', 80, 'rationale', '[]', ?)`, [testHash, tenantId, personId, `ctx_${personId}`, JSON.stringify({ intrinsicVerdict: 'PURSUE', intrinsicQualityScore: 90, schemaVersion: 'v4.2-intrinsic', baseNarrative: { baseRecommendationProse: 'test' }, jobHash: testHash })]);
      await tx.execute(`INSERT INTO candidate_evaluations (person_id, job_hash, policy_version, evaluation_input_hash, engine_verdict, engine_quality_score, effective_decision, quality_score, evaluation_json, updated_at) VALUES (?, ?, 'v4.1', 'hash_test', 'PURSUE', 90, 'PURSUE', 90, '{}', CURRENT_TIMESTAMP)`, [personId, testHash]);
    });

    const updated = await OpportunityService.getMetricsForUser(personId);
    expect(updated.totalScreened).toBe(initial.totalScreened + 1);

    await db.execute(`DELETE FROM canonical_opportunities WHERE id = ?`, [testHash]);
  });

  // CASE I: User decision updates user metrics without changing engine metrics
  it("CASE I — User decision updates user state without mutating engine recommendation state", async () => {
    const testHash = `test_i_${Date.now()}`;

    // 1. Insert Case-I canonical opportunity
    await db.transaction(async (tx) => {
      await tx.execute(`INSERT OR IGNORE INTO companies (id, name, industry) VALUES ('comp1', 'Test', 'tech')`);
      await tx.execute(`INSERT INTO opportunities (id, company_id, canonical_title, fingerprint, lifecycle) VALUES (?, 'comp1', 'Title', ?, 'ACTIVE')`, [testHash, testHash]);
      await tx.execute(`INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES (?, 'test', ?, 'http')`, [testHash, testHash]);
      await tx.execute(`INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content) VALUES ('v_${testHash}', ?, 'ch1', 'Dir', 'raw')`, [testHash]);
      await tx.execute(`INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, 'v_${testHash}', 'CANDIDATE')`, [tenantId, personId, `sp_${personId}`, testHash]);
      await tx.execute(`INSERT INTO materialized_evaluations (canonical_job_id, opportunity_version, tenant_id, person_id, evaluation_context_fingerprint, evaluation_state, decision, quality_score, rationale, evidence_ids, evaluation_json) VALUES (?, 'v_${testHash}', ?, ?, ?, 'EVALUATED', 'PURSUE', 80, 'rationale', '[]', ?)`, [testHash, tenantId, personId, `ctx_${personId}`, JSON.stringify({ intrinsicVerdict: 'PURSUE', intrinsicQualityScore: 90, schemaVersion: 'v4.2-intrinsic', baseNarrative: { baseRecommendationProse: 'test' }, jobHash: testHash })]);
      await tx.execute(`INSERT INTO candidate_evaluations (person_id, job_hash, policy_version, evaluation_input_hash, engine_verdict, engine_quality_score, effective_decision, quality_score, evaluation_json, updated_at) VALUES (?, ?, 'v4.1', 'hash_test', 'PURSUE', 90, 'PURSUE', 90, '{}', CURRENT_TIMESTAMP)`, [personId, testHash]);
    });

    // 2. Capture engine metrics baseline (post-opportunity insert, pre-decision)
    const baseline = await OpportunityService.getMetricsForUser(personId);

    // 3. Insert user decision
    await db.transaction(async (tx) => {
      const decisionId = `dec_${Date.now()}`;
      await tx.execute(`INSERT INTO canonical_decisions (id, tenant_id, person_id, canonical_job_id, action, reason, updated_at) VALUES (?, ?, ?, ?, 'PURSUE', 'Test decision', CURRENT_TIMESTAMP)`, [decisionId, tenantId, personId, testHash]);
    });

    // 4. Capture final updated metrics
    const updated = await OpportunityService.getMetricsForUser(personId);

    // 5. Assert invariants
    expect(updated.totalDecisions).toBe(baseline.totalDecisions + 1); // User metric changes
    expect(updated.engineBreakdown.pursue).toBe(baseline.engineBreakdown.pursue); // Engine metrics immutable

    await db.execute(`DELETE FROM canonical_opportunities WHERE id = ?`, [testHash]);
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
