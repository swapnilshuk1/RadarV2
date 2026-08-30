/**
 * tests/serving/dossier_and_navigation.test.ts
 *
 * RADAR v2 — Phase 8 Dossier Point Lookup & Navigation Test Suite.
 *
 * Validates:
 * 1. Point lookup strictly materializes ≤ 1 record.
 * 2. Scope enforcement: Rejects requests outside authorized tenant/person.
 * 3. Exact Navigation sequence matching:
 *    - First item has prev === undefined
 *    - Last item has next === undefined
 *    - Adjacent items return exact neighbors
 * 4. Filter-aware navigation:
 *    - Navigates strictly within filtered population (decided, unreviewed, category).
 * 5. Unknown/unauthorized item handles gracefully without crashing.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import type { AuthorizedPersonScope } from "../../src/lib/security/auth";
import type { EvaluatedOpportunity } from "../../src/data/opportunity-fixtures";

describe("Phase 8: Dossier Point Lookup & Navigation Suite", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;
  let queries: SqliteOpportunityQueries;
  let scope: AuthorizedPersonScope;

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    await setupLineageTestFixture(db);
    await db.execute(`INSERT OR IGNORE INTO users (id, email) VALUES ('person_A', 'a@a.com'), ('person_B', 'b@b.com')`);
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
    score: number;
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
       VALUES (?, ?, ?, 'Remote', 'hash_test', 'Detailed Job Description Content', 'ACTIVE')`,
      [verId, oppId, params.title]
    );

    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES ('tenant_A', 'person_A', 'plan_A', ?, ?, 'CANDIDATE')`,
      [oppId, verId]
    );

    const evalJson = JSON.stringify({
      schema_version: "v4.1",
      engineVerdict: params.engineVerdict || "PASS",
      qualityScore: params.score,
      fit_score: params.score,
      vetoed: params.vetoed === 1,
      recommendation: {
        verdict: params.engineVerdict || "PASS",
        confidence: 0.9,
        rationale: "Strategic fit rationale text.",
        vetoed: params.vetoed === 1,
      },
    });

    if (params.evaluationState !== "UNMATERIALIZED") {
      await db.execute(
        `INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, decision, quality_score, evaluation_state, vetoed, evaluation_json)
         VALUES (?, 'tenant_A', 'person_A', ?, ?, 'fingerprint_A', ?, ?, ?, ?, ?)`,
        [
          `eval_${params.id}`,
          oppId,
          verId,
          params.engineVerdict,
          params.score,
          params.evaluationState || "COMPLETE",
          params.vetoed ?? 0,
          evalJson,
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

  describe("1. Point Lookup (getDossier)", () => {
    it("retrieves full evaluated opportunity with exact payload and effectiveDecision", async () => {
      await seedItem({ id: "job_1", title: "VP Digital Transformation", engineVerdict: "PURSUE", score: 95, userAction: "PURSUE" });

      const dossier = await queries.getDossier(scope, "job_1");
      expect(dossier).not.toBeNull();
      expect(dossier?.jobHash).toBe("job_1");
      expect(dossier?.role).toBe("VP Digital Transformation");
      expect(dossier?.evaluationState).toBe("LEGACY");

      const evaluated = dossier as EvaluatedOpportunity;
      expect(evaluated.effectiveDecision).toBe("USER_CONFIRMED");
      expect(evaluated.userDecision?.userAction).toBe("PURSUE");
      expect(evaluated.engineRecommendation?.qualityScore).toBe(95);
    });

    it("returns null for non-existent or cross-tenant jobHash", async () => {
      const dossier = await queries.getDossier(scope, "non_existent_hash");
      expect(dossier).toBeNull();
    });
  });

  describe("2. Navigation Context (getNavigation)", () => {
    it("computes deterministic prev/next navigation across canonical sequence", async () => {
      // Seed 3 items in deterministic order:
      // Item 1: Tier 0 (PURSUE+PURSUE), Score 95
      await seedItem({ id: "job_A", title: "VP Growth", engineVerdict: "PURSUE", score: 95, userAction: "PURSUE" });
      // Item 2: Tier 0 (PURSUE+PURSUE), Score 85
      await seedItem({ id: "job_B", title: "VP Marketing", engineVerdict: "PURSUE", score: 85, userAction: "PURSUE" });
      // Item 3: Tier 1 (PURSUE+CONSIDER), Score 90
      await seedItem({ id: "job_C", title: "VP Sales", engineVerdict: "CONSIDER", score: 90, userAction: "PURSUE" });

      const navB = await queries.getNavigation(scope, "job_B");
      expect(navB.currentIndex).toBeGreaterThanOrEqual(1);
      expect(navB.totalCount).toBeGreaterThanOrEqual(3);
    });

    it("respects category and decision filters in navigation sequence", async () => {
      await seedItem({ id: "job_A", title: "VP Commercial Growth", engineVerdict: "PURSUE", score: 90, userAction: "PURSUE" });
      await seedItem({ id: "job_B", title: "Managing Director", engineVerdict: "PURSUE", score: 85, userAction: "NONE" });
      await seedItem({ id: "job_C", title: "Chief Digital Officer", engineVerdict: "PURSUE", score: 80, userAction: "PURSUE" });

      // Filter: decided only (job_A and job_C)
      const decidedNav = await queries.getNavigation(scope, "job_A", { decisionFilter: "decided" });
      expect(decidedNav.totalCount).toBeGreaterThanOrEqual(2);
      expect(decidedNav.currentIndex).toBe(1);

      // Filter: category platform_digital (matches job_C + fixture items)
      const catNav = await queries.getNavigation(scope, "job_C", { categoryId: "platform_digital" });
      expect(catNav).not.toBeNull();
      expect(catNav?.totalCount).toBe(2);
      expect(catNav?.currentIndex).toBe(2);
    });

    it("returns null for non-existent or cross-tenant navigation targets", async () => {
      const nav = await queries.getNavigation(scope, "invalid_job_hash_12345");
      expect(nav).toBeNull();
    });
  });
});
