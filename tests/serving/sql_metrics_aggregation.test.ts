/**
 * tests/serving/sql_metrics_aggregation.test.ts
 *
 * RADAR v2 — Phase 7 SQL Metrics Aggregation Unit & Edge Fixture Suite.
 *
 * Validates:
 * 1. Exact mathematical aggregation across all decision/engine verdict edge permutations.
 * 2. Strict AST invariants: No evaluation_json, no raw_content, no SELECT *.
 * 3. Exact Category breakdown calculation without corpus hydration.
 */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import type { AuthorizedPersonScope } from "../../src/lib/security/auth";

describe("Phase 7: SQL Metrics Aggregation Suite", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;
  let queries: SqliteOpportunityQueries;
  let scope: AuthorizedPersonScope;

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    await setupLineageTestFixture(db);
    await db.execute(`INSERT OR IGNORE INTO users (id, email) VALUES ('person_A', 'a@a.com')`);
    await db.execute(
      `INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, permissions, status)
       VALUES ('person_A', 'tenant_A', 'admin', '["*"]', 'active')`
    );
    await db.execute(
      `INSERT OR IGNORE INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint)
       VALUES ('tenant_A', 'person_A', 'plan_A', 'fingerprint_A')`
    );
    queries = new SqliteOpportunityQueries(db);
    const resolved = await resolveServingScope("person_A", "tenant_A", db);
    scope = resolved.scope;
  });

  async function seedItem(params: {
    id: string;
    title: string;
    engineVerdict: string | null;
    vetoed?: number;
    evaluationState?: string;
    userAction?: string;
  }) {
    const oppId = `opp_${params.id}`;
    const verId = `ver_${params.id}`;

    await db.execute(
      `INSERT INTO canonical_opportunities (id, source_job_id, company_name, source, canonical_url)
       VALUES (?, ?, 'Acme Corp', 'LinkedIn', 'https://example.com/job')`,
      [oppId, params.id]
    );

    await db.execute(
      `INSERT INTO opportunity_versions (id, canonical_job_id, job_title, location, content_hash, raw_content, lifecycle_state)
       VALUES (?, ?, ?, 'Remote', 'hash_test', 'test content', 'ACTIVE')`,
      [verId, oppId, params.title]
    );

    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES ('tenant_A', 'person_A', 'plan_A', ?, ?, 'CANDIDATE')`,
      [oppId, verId]
    );

    if (params.evaluationState !== "UNMATERIALIZED") {
      await db.execute(
        `INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, decision, quality_score, evaluation_state, vetoed, evaluation_json)
         VALUES (?, 'tenant_A', 'person_A', ?, ?, 'fingerprint_A', ?, 85, ?, ?, '{}')`,
        [
          `eval_${params.id}`,
          oppId,
          verId,
          params.engineVerdict,
          params.evaluationState || "COMPLETE",
          params.vetoed ?? 0,
        ]
      );
    }

    if (params.userAction && params.userAction !== "NONE") {
      await db.execute(
        `INSERT INTO canonical_decisions (tenant_id, person_id, canonical_job_id, action)
         VALUES ('tenant_A', 'person_A', ?, ?)`,
        [oppId, params.userAction]
      );
    }
  }

  describe("1. Architectural & AST Invariants", () => {
    it("strictly prohibits evaluation_json and raw_content in getMetrics", () => {
      const sourceFile = fs.readFileSync(
        path.resolve(process.cwd(), "src/data/sqlite/repositories/SqliteOpportunityQueries.ts"),
        "utf-8"
      );

      const metricsSection = sourceFile.split("async getMetrics")[1]?.split("async getDossier")[0] || "";

      expect(metricsSection).not.toContain("SELECT evaluation_json");
      expect(metricsSection).not.toContain("me.evaluation_json");
      expect(metricsSection).not.toContain("ov.raw_content");
      expect(metricsSection).not.toContain("SELECT raw_content");
      expect(metricsSection).not.toContain("SELECT *");
    });
  });

  describe("2. Comprehensive Edge Fixture Decision Matrix", () => {
    it("correctly aggregates all 10 edge fixtures into canonical metrics", async () => {
      // 1. PURSUE + PASS -> vetoOverride
      await seedItem({ id: "1", title: "VP Digital", engineVerdict: "PASS", userAction: "PURSUE" });

      // 2. PURSUE + CONSIDER + veto=true -> vetoOverride
      await seedItem({ id: "2", title: "Chief Digital Officer", engineVerdict: "CONSIDER", vetoed: 1, userAction: "PURSUE" });

      // 3. PURSUE + CONSIDER + veto=false -> preferenceOverride
      await seedItem({ id: "3", title: "VP Growth", engineVerdict: "CONSIDER", vetoed: 0, userAction: "PURSUE" });

      // 4. PURSUE + PURSUE -> userConfirmed
      await seedItem({ id: "4", title: "Managing Director", engineVerdict: "PURSUE", vetoed: 0, userAction: "PURSUE" });

      // 5. CONSIDER + CONSIDER -> engineConsider
      await seedItem({ id: "5", title: "VP Transformation", engineVerdict: "CONSIDER", userAction: "CONSIDER" });

      // 6. CONSIDER + PURSUE -> preferenceOverride
      await seedItem({ id: "6", title: "CTO", engineVerdict: "PURSUE", userAction: "CONSIDER" });

      // 7. CONSIDER + PASS -> preferenceOverride
      await seedItem({ id: "7", title: "President", engineVerdict: "PASS", userAction: "CONSIDER" });

      // 8. PASS + PURSUE (Engine) -> userPassed
      await seedItem({ id: "8", title: "VP Sales", engineVerdict: "PURSUE", userAction: "PASS" });

      // 9. NONE + SPARSE -> unreviewedSparse
      await seedItem({ id: "9", title: "Founder-led COO", engineVerdict: "SPARSE_SPEC", evaluationState: "SPARSE_SPEC", userAction: "NONE" });

      // 10. NONE + UNMATERIALIZED -> unmaterialized pass
      await seedItem({ id: "10", title: "VP Commercial", engineVerdict: null, evaluationState: "UNMATERIALIZED", userAction: "NONE" });

      const metrics = await queries.getMetrics(scope);

      // Core Population
      expect(metrics.totalScreened).toBe(10);
      expect(metrics.totalDecisions).toBe(8);
      expect(metrics.remainingToReview).toBe(2);
      expect(metrics.totalShortlisted).toBe(6); // items 4, 6, 8 (PURSUE) + items 2, 3, 5 (CONSIDER) = 6

      // Engine Breakdown (evaluated only)
      expect(metrics.engineBreakdown.pursue).toBe(3); // 4, 6, 8
      expect(metrics.engineBreakdown.consider).toBe(3); // 2, 3, 5
      expect(metrics.engineBreakdown.pass).toBe(4); // 1, 7 (evaluated PASS) + 9 (sparse) + 10 (unmaterialized) = 4
      expect(metrics.engineBreakdown.sparse).toBe(0);

      // User Breakdown
      expect(metrics.userBreakdown.pursue).toBe(4); // 1, 2, 3, 4
      expect(metrics.userBreakdown.consider).toBe(3); // 5, 6, 7
      expect(metrics.userBreakdown.pass).toBe(1); // 8
      expect(metrics.userBreakdown.total).toBe(8);

      // Decision Metrics Overrides
      expect(metrics.decisionMetrics?.userConfirmed).toBe(1); // item 4
      expect(metrics.decisionMetrics?.preferenceOverride).toBe(3); // item 3 (PURSUE+CONSIDER), item 6 (CONSIDER+PURSUE), item 7 (CONSIDER+PASS)
      expect(metrics.decisionMetrics?.vetoOverride).toBe(2); // item 1 (PURSUE+PASS), item 2 (PURSUE+CONSIDER+veto=1)
      expect(metrics.decisionMetrics?.userPassed).toBe(1); // item 8

      // Effective Breakdown
      expect(metrics.effectiveBreakdown.pursue).toBe(3); // 1 (veto), 2 (veto), 4 (confirmed) -> 3
      expect(metrics.effectiveBreakdown.consider).toBe(4); // 3 (pref), 5 (engine_consider), 6 (pref), 7 (pref) -> 4
      expect(metrics.effectiveBreakdown.pass).toBe(3); // 8 (user_pass) + 9 (sparse) + 10 (unmat) = 3
    });
  });
});
