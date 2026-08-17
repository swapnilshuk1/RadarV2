import { describe, it, expect, beforeEach } from "vitest";
import { getDatabaseAdapter } from "../src/data/database";
import { SqliteEvaluationStore } from "../src/data/sqlite/repositories/SqliteEvaluationStore";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";
import { MetricIntegrityValidator } from "../src/lib/intelligence/metric-integrity";
import {
  resolveCanonicalCategoryId,
  classifyOpportunityCategories,
} from "../src/lib/domain/category_taxonomy";

describe("RADAR Phase 7.3 — Filter Population Integrity & Taxonomy Test Suite", () => {
  const db = getDatabaseAdapter();

  function makeUser(prefix: string) {
    return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  it("CASE I: Taxonomy Alias Resolution & Classification Consistency", () => {
    expect(resolveCanonicalCategoryId("Commercial Growth")).toBe("commercial_growth");
    expect(resolveCanonicalCategoryId("COMMERCIAL")).toBe("commercial_growth");
    expect(resolveCanonicalCategoryId("high_growth")).toBe("commercial_growth");
    expect(resolveCanonicalCategoryId("Transformation")).toBe("transformation");
    expect(resolveCanonicalCategoryId("Needs More Signal")).toBe("needs_more_signal");
    expect(resolveCanonicalCategoryId("Country Leadership")).toBe("country_leadership");
    expect(resolveCanonicalCategoryId("Platform & Digital")).toBe("platform_digital");

    const sampleOpp = {
      role: "VP Commercial Growth & Sales",
      description: "Drive revenue expansion and GTM strategy across APAC.",
      recommendation: "PURSUE",
      trueExecutiveMandate: "COMMERCIAL_EXPANSION",
    };

    const categories = classifyOpportunityCategories(sampleOpp);
    expect(categories).toContain("all");
    expect(categories).toContain("commercial_growth");
  });

  it("CASE A & G: Category records outside top 100 are properly retrieved via Filter-Before-Limit", async () => {
    const userA = makeUser("usr_case_a");
    const evalStore = new SqliteEvaluationStore(db);

    // Insert 120 dummy evaluations in batches to avoid network latency
    const values: string[] = [];
    const params: any[] = [];

    for (let i = 1; i <= 120; i++) {
      const isCommercial = i > 100;
      const roleTitle = isCommercial ? "VP Commercial Growth" : "VP Transformation";
      const qualityScore = 1000 - i; // Lower score for commercial items (> 100 rank)

      const evalJson = JSON.stringify({
        jobHash: `job_test_${i}`,
        role: roleTitle,
        company: "Acme Corp",
        recommendation: "PURSUE",
        qualityScore,
        trueExecutiveMandate: isCommercial ? "COMMERCIAL_EXPANSION" : "TRANSFORMATION",
      });

      values.push("(?, ?, 'v4.1', 'hash_test', 'PURSUE', ?, 'PURSUE', ?, 'COMPLETE', ?)");
      params.push(userA, `job_test_${i}`, qualityScore, qualityScore, evalJson);
    }

    await db.execute(
      `INSERT INTO candidate_evaluations 
       (person_id, job_hash, policy_version, evaluation_input_hash, engine_verdict, engine_quality_score, effective_decision, quality_score, evaluation_status, evaluation_json)
       VALUES ${values.join(", ")}`,
      params
    );

    // 1. Verify Category Metrics on Full Corpus
    const categoryMetrics = await evalStore.getCategoryMetrics(userA);
    expect(categoryMetrics["all"].total).toBe(120);
    expect(categoryMetrics["transformation"].total).toBe(100);
    expect(categoryMetrics["commercial_growth"].total).toBe(20);

    // 2. Verify Filter-Before-Limit Retrieval for Commercial Growth (items ranked 101–120)
    const filteredCommercial = await evalStore.listEvaluationsForUser(userA, 50, "commercial_growth");
    expect(filteredCommercial.length).toBe(20);
    expect(filteredCommercial[0].jobHash).toBe("job_test_101");
  }, 15000);

  it("CASE B & F: Unreviewed vs Reviewed Counts and Shortlist Calculations", async () => {
    const userA = makeUser("usr_case_b");
    const evalStore = new SqliteEvaluationStore(db);

    // Insert 5 commercial growth evaluations
    for (let i = 1; i <= 5; i++) {
      const evalJson = JSON.stringify({
        jobHash: `job_rev_${i}`,
        role: "Chief Commercial Officer",
        recommendation: "PURSUE",
        trueExecutiveMandate: "COMMERCIAL_EXPANSION",
      });

      await db.execute(
        `INSERT INTO candidate_evaluations 
         (person_id, job_hash, policy_version, evaluation_input_hash, engine_verdict, engine_quality_score, effective_decision, quality_score, evaluation_status, evaluation_json)
         VALUES (?, ?, 'v4.1', 'hash_rev', 'PURSUE', 90, 'PURSUE', 90, 'COMPLETE', ?)`,
        [userA, `job_rev_${i}`, evalJson]
      );
    }

    // Record decision on 2 items
    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, updated_at) VALUES (?, ?, 'PURSUE', CURRENT_TIMESTAMP)`,
      [userA, "job_rev_1"]
    );
    await db.execute(
      `INSERT INTO decisions (person_id, opportunity_id, action, updated_at) VALUES (?, ?, 'PASS', CURRENT_TIMESTAMP)`,
      [userA, "job_rev_2"]
    );

    const categoryMetrics = await evalStore.getCategoryMetrics(userA);
    const commMetrics = categoryMetrics["commercial_growth"];
    expect(commMetrics.total).toBe(5);
    expect(commMetrics.unreviewed).toBe(3); // 5 - 2 reviewed
  });

  it("CASE C: Empty Category returns legitimate zero without error", async () => {
    const userA = makeUser("usr_case_c");
    const evalStore = new SqliteEvaluationStore(db);

    // Insert 1 Transformation item only
    const evalJson = JSON.stringify({
      jobHash: "job_trans_1",
      role: "VP Transformation",
      recommendation: "PURSUE",
      trueExecutiveMandate: "TRANSFORMATION",
    });

    await db.execute(
      `INSERT INTO candidate_evaluations 
       (person_id, job_hash, policy_version, evaluation_input_hash, engine_verdict, engine_quality_score, effective_decision, quality_score, evaluation_status, evaluation_json)
       VALUES (?, 'job_trans_1', 'v4.1', 'hash_t', 'PURSUE', 90, 'PURSUE', 90, 'COMPLETE', ?)`,
      [userA, evalJson]
    );

    const categoryMetrics = await evalStore.getCategoryMetrics(userA);
    expect(categoryMetrics["private_equity"].total).toBe(0);
    expect(categoryMetrics["private_equity"].unreviewed).toBe(0);

    const filteredPE = await evalStore.listEvaluationsForUser(userA, 50, "private_equity");
    expect(filteredPE.length).toBe(0);
  });

  it("CASE J: User Isolation prevents cross-user leakage of category metrics", async () => {
    const userA = makeUser("usr_case_j_a");
    const userB = makeUser("usr_case_j_b");
    const evalStore = new SqliteEvaluationStore(db);

    // User A has 10 Commercial Growth items
    for (let i = 1; i <= 10; i++) {
      await db.execute(
        `INSERT INTO candidate_evaluations 
         (person_id, job_hash, policy_version, evaluation_input_hash, engine_verdict, engine_quality_score, effective_decision, quality_score, evaluation_status, evaluation_json)
         VALUES (?, ?, 'v4.1', 'hash_a', 'PURSUE', 80, 'PURSUE', 80, 'COMPLETE', ?)`,
        [userA, `job_a_${i}`, JSON.stringify({ role: "VP Commercial Growth", trueExecutiveMandate: "COMMERCIAL_EXPANSION" })]
      );
    }

    // User B has 2 Transformation items
    for (let i = 1; i <= 2; i++) {
      await db.execute(
        `INSERT INTO candidate_evaluations 
         (person_id, job_hash, policy_version, evaluation_input_hash, engine_verdict, engine_quality_score, effective_decision, quality_score, evaluation_status, evaluation_json)
         VALUES (?, ?, 'v4.1', 'hash_b', 'PURSUE', 80, 'PURSUE', 80, 'COMPLETE', ?)`,
        [userB, `job_b_${i}`, JSON.stringify({ role: "VP Transformation", trueExecutiveMandate: "TRANSFORMATION" })]
      );
    }

    const metricsA = await evalStore.getCategoryMetrics(userA);
    const metricsB = await evalStore.getCategoryMetrics(userB);

    expect(metricsA["commercial_growth"].total).toBe(10);
    expect(metricsA["transformation"].total).toBe(0);

    expect(metricsB["commercial_growth"].total).toBe(0);
    expect(metricsB["transformation"].total).toBe(2);
  });

  it("CASE K & L: MetricIntegrityValidator enforces category bounds", async () => {
    const userA = makeUser("usr_case_k");
    const metrics = await OpportunityService.getMetricsForUser(userA);
    expect(metrics.integrity.status).toBe("PASS");

    // Fault Injection: Category unreviewed > totalScreened
    const corruptSnapshot: any = {
      ...metrics,
      totalScreened: 10,
      categoryMetrics: {
        commercial_growth: { total: 50, unreviewed: 40, shortlisted: 30 },
      },
    };

    const validationResult = await MetricIntegrityValidator.validate(corruptSnapshot, db);
    expect(validationResult.status).toBe("ERROR");
    expect(validationResult.discrepancies.some((d) => d.code.startsWith("INV_CATEGORY_"))).toBe(true);
  });
});
