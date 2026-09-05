/**
 * tests/serving/keyset_pagination.test.ts
 *
 * RADAR v2 — Phase 6 Keyset Pagination & Deterministic Ordering Test Suite.
 *
 * Mathematically tests:
 * 1. Ordering Invariant: (populationTier ASC, qualityScore DESC NULLS LAST, jobHash ASC).
 * 2. NULL-Score Boundary Matrix:
 *    - same tier + scored -> scored
 *    - same tier + scored -> NULL
 *    - same tier + NULL -> NULL
 *    - different tier -> tier wins
 *    - same tier + same score -> jobHash tie-break
 *    - score = 100, score = 50, score = 0, score = NULL
 * 3. Exact Multi-Page Traversal: No duplicates, no omissions, cursor round-trip precision.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { encodeCursor, decodeCursor } from "../../src/lib/intelligence/cursor";
import { CursorValidationError } from "../../src/lib/intelligence/cursor";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";

describe("Phase 6: Keyset Pagination & Deterministic Ordering", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;
  let queries: SqliteOpportunityQueries;

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
    expect(resolved.activeContext?.searchPlanId).toBe("plan_A");
    expect(resolved.activeContext?.contextFingerprint).toBe("fingerprint_A");
  });

  async function seedOpportunity(params: {
    jobId: string;
    hash: string;
    title: string;
    verdict: string | null;
    score: number | null;
    vetoed?: number;
    action?: string;
    attention?: string;
    evalState?: string;
    categoryIds?: string[];
  }) {
    await db.execute(
      `INSERT INTO canonical_opportunities (id, source_job_id, source, company_name, canonical_url)
       VALUES (?, ?, 'LinkedIn', 'Test Corp', 'https://apply/test')`,
      [params.jobId, params.hash]
    );
    await db.execute(
      `INSERT INTO opportunity_versions (id, canonical_job_id, job_title, location, content_hash, raw_content, lifecycle_state)
       VALUES (?, ?, ?, 'Bengaluru', 'hash_test', 'Description', 'ACTIVE')`,
      [`ov_${params.jobId}`, params.jobId, params.title]
    );
    if (params.categoryIds) {
      await db.execute(
        `UPDATE opportunity_versions SET category_ids = ? WHERE id = ?`,
        [JSON.stringify(["all", ...params.categoryIds]), `ov_${params.jobId}`],
      );
    }
    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES ('tenant_A', 'person_A', 'plan_A', ?, ?, ?)`,
      [params.jobId, `ov_${params.jobId}`, params.attention || "CANDIDATE"]
    );
    if (params.verdict !== null || params.score !== null || params.evalState !== undefined) {
      await db.execute(
        `INSERT INTO materialized_evaluations (id, canonical_job_id, opportunity_version, tenant_id, person_id, evaluation_context_fingerprint, evaluation_fingerprint, evaluation_state, decision, quality_score, vetoed, evaluation_json)
         VALUES (?, ?, ?, 'tenant_A', 'person_A', 'fingerprint_A', ?, ?, ?, ?, ?, '{}')`,
        [
          `me_${params.jobId}`,
          params.jobId,
          `ov_${params.jobId}`,
          `eval_${params.jobId}`,
          params.evalState || "COMPLETE",
          params.verdict,
          params.score,
          params.vetoed || 0,
        ]
      );
    }
    if (params.action) {
      await db.execute(
        `INSERT INTO canonical_decisions (id, tenant_id, person_id, canonical_job_id, action, updated_at)
         VALUES (?, 'tenant_A', 'person_A', ?, ?, '2026-08-30 00:00:00')`,
        [`dec_${params.jobId}`, params.jobId, params.action]
      );
    }
  }

  describe("1. NULL-Score & Lexicographic Ordering Boundary Suite", () => {
    it("orders by (tier ASC, quality_score DESC NULLS LAST, jobHash ASC) across scores 100, 50, 0, NULL", async () => {
      // Seed opportunities within Tier 0 (ENGINE_PURSUIT) with varied scores
      await seedOpportunity({ jobId: "j1", hash: "hash_c", title: "VP 1", verdict: "PURSUE", score: 50 });
      await seedOpportunity({ jobId: "j2", hash: "hash_a", title: "VP 2", verdict: "PURSUE", score: 100 });
      await seedOpportunity({ jobId: "j3", hash: "hash_d", title: "VP 3", verdict: "PURSUE", score: 0 });
      await seedOpportunity({ jobId: "j4", hash: "hash_b", title: "VP 4", verdict: "PURSUE", score: 100 }); // Same score 100, tie-break by hash
      await seedOpportunity({ jobId: "j5", hash: "hash_e", title: "VP 5", verdict: "PURSUE", score: null }); // NULL score in Tier 0

      // Seed opportunity in Tier 1 (PREFERENCE_OVERRIDE) with score 99
      await seedOpportunity({ jobId: "j6", hash: "hash_f", title: "VP 6", verdict: "CONSIDER", score: 99, action: "PURSUE" });

      const page = await queries.getFeed({ tenantId: "tenant_A", personId: "person_A" }, undefined, undefined, 10);

      // Expected order:
      // 1. Tier 0, score 100, hash_a
      // 2. Tier 0, score 100, hash_b
      // 3. Tier 0, score 50,  hash_c
      // 4. Tier 0, score 0,   hash_d
      // 5. Tier 1, score 99, hash_f
      // 6. hash_e has no score, so it is non-actionable rather than a valid PURSUE.

      expect(page.items.map((i) => i.jobHash)).toEqual([
        "hash_a",
        "hash_b",
        "hash_c",
        "hash_d",
        "hash_f",
        "hash_e",
      ]);
    });

    it("paginates seamlessly across scored -> scored, scored -> NULL, and NULL -> NULL boundaries", async () => {
      await seedOpportunity({ jobId: "j1", hash: "h1", title: "VP 1", verdict: "PURSUE", score: 80 });
      await seedOpportunity({ jobId: "j2", hash: "h2", title: "VP 2", verdict: "PURSUE", score: 60 });
      await seedOpportunity({ jobId: "j3", hash: "h3", title: "VP 3", verdict: "PURSUE", score: null });
      await seedOpportunity({ jobId: "j4", hash: "h4", title: "VP 4", verdict: "PURSUE", score: null });

      const scope = { tenantId: "tenant_A", personId: "person_A" };

      // Page 1: pageSize = 1 (gets h1, score 80)
      const p1 = await queries.getFeed(scope, undefined, undefined, 1);
      expect(p1.items).toHaveLength(1);
      expect(p1.items[0].jobHash).toBe("h1");
      expect(p1.hasMore).toBe(true);
      expect(p1.nextCursor).not.toBeNull();

      // Page 2: from p1 cursor (scored -> scored, gets h2, score 60)
      const p2 = await queries.getFeed(scope, p1.nextCursor!, undefined, 1);
      expect(p2.items).toHaveLength(1);
      expect(p2.items[0].jobHash).toBe("h2");
      expect(p2.hasMore).toBe(true);

      // Page 3: from p2 cursor (scored -> NULL, gets h3, score null)
      const p3 = await queries.getFeed(scope, p2.nextCursor!, undefined, 1);
      expect(p3.items).toHaveLength(1);
      expect(p3.items[0].jobHash).toBe("h3");
      expect(p3.hasMore).toBe(true);

      // Page 4: from p3 cursor (NULL -> NULL, gets h4, score null)
      const p4 = await queries.getFeed(scope, p3.nextCursor!, undefined, 1);
      expect(p4.items).toHaveLength(1);
      expect(p4.items[0].jobHash).toBe("h4");
      expect(p4.hasMore).toBe(false);
      expect(p4.nextCursor).toBeNull();
    });
  });

  describe("2. Cursor Round-Trip Precision", () => {
    it("guarantees cursor encode -> decode -> next query returns exact next item", async () => {
      for (let i = 0; i < 10; i++) {
        await seedOpportunity({
          jobId: `job_${i}`,
          hash: `hash_${String(i).padStart(2, "0")}`,
          title: `Executive ${i}`,
          verdict: "PURSUE",
          score: 90 - i * 5,
        });
      }

      const scope = { tenantId: "tenant_A", personId: "person_A" };
      let currentCursor: string | undefined = undefined;
      const collectedHashes: string[] = [];

      while (true) {
        const page = await queries.getFeed(scope, currentCursor ? (currentCursor as any) : undefined, undefined, 3);
        for (const item of page.items) {
          collectedHashes.push(item.jobHash);
        }
        if (!page.hasMore || !page.nextCursor) break;
        currentCursor = page.nextCursor;
      }

      expect(collectedHashes).toHaveLength(10);
      expect(new Set(collectedHashes).size).toBe(10);
      expect(collectedHashes).toEqual([
        "hash_00", "hash_01", "hash_02", "hash_03", "hash_04",
        "hash_05", "hash_06", "hash_07", "hash_08", "hash_09",
      ]);
    });
  });

  describe("3. Category filter precedes keyset pagination", () => {
    it("returns a full, stable category page without skipping qualifying rows behind other categories", async () => {
      await seedOpportunity({ jobId: "a", hash: "A", title: "A", verdict: "PURSUE", score: 95, categoryIds: ["transformation"] });
      await seedOpportunity({ jobId: "b", hash: "B", title: "B", verdict: "PURSUE", score: 94, categoryIds: ["commercial_growth"] });
      await seedOpportunity({ jobId: "c", hash: "C", title: "C", verdict: "PURSUE", score: 93, categoryIds: ["transformation"] });
      await seedOpportunity({ jobId: "d", hash: "D", title: "D", verdict: "PURSUE", score: 92, categoryIds: ["transformation"] });

      const scope = { tenantId: "tenant_A", personId: "person_A" };
      const first = await queries.getFeed(scope, undefined, { categoryId: "transformation" }, 2);
      const second = await queries.getFeed(scope, first.nextCursor!, { categoryId: "transformation" }, 2);

      expect(first.items.map((item) => item.jobHash)).toEqual(["A", "C"]);
      expect(first.hasMore).toBe(true);
      expect(second.items.map((item) => item.jobHash)).toEqual(["D"]);
      expect(second.hasMore).toBe(false);
      expect(new Set([...first.items, ...second.items].map((item) => item.jobHash)).size).toBe(3);
    });

    it("uses exact JSON category membership rather than substring matching", async () => {
      await seedOpportunity({ jobId: "platform", hash: "platform-digital", title: "Platform", verdict: "PURSUE", score: 95, categoryIds: ["platform_digital"] });
      await seedOpportunity({ jobId: "exact", hash: "platform", title: "Exact", verdict: "PURSUE", score: 90, categoryIds: ["platform"] });

      const page = await queries.getFeed(
        { tenantId: "tenant_A", personId: "person_A" },
        undefined,
        { categoryId: "platform" },
        10,
      );

      expect(page.items.map((item) => item.jobHash)).toEqual(["platform"]);
    });

    it("derives needs_more_signal from evaluation state, not persisted content categories", async () => {
      await seedOpportunity({
        jobId: "sparse",
        hash: "sparse-content",
        title: "Commercial Role",
        verdict: "SPARSE_SPEC",
        score: 0,
        evalState: "SPARSE_SPEC",
        categoryIds: ["commercial_growth"],
      });
      await seedOpportunity({
        jobId: "complete",
        hash: "complete-content",
        title: "Commercial Role",
        verdict: "CONSIDER",
        score: 85,
        categoryIds: ["commercial_growth"],
      });

      const page = await queries.getFeed(
        { tenantId: "tenant_A", personId: "person_A" },
        undefined,
        { categoryId: "needs_more_signal" },
        10,
      );

      expect(page.items.map((item) => item.jobHash)).toEqual(["sparse-content"]);
      expect(page.items[0].categoryIds).toContain("needs_more_signal");
      expect(page.items[0].categoryIds).toContain("commercial_growth");
    });

    it("rejects a cursor when category membership differs from the page that created it", async () => {
      await seedOpportunity({ jobId: "a", hash: "A", title: "A", verdict: "PURSUE", score: 95, categoryIds: ["transformation"] });
      await seedOpportunity({ jobId: "b", hash: "B", title: "B", verdict: "PURSUE", score: 94, categoryIds: ["commercial_growth"] });
      await seedOpportunity({ jobId: "c", hash: "C", title: "C", verdict: "PURSUE", score: 93, categoryIds: ["transformation"] });
      await seedOpportunity({ jobId: "d", hash: "D", title: "D", verdict: "PURSUE", score: 92, categoryIds: ["transformation"] });

      const scope = { tenantId: "tenant_A", personId: "person_A" };
      const all = await queries.getFeed(scope, undefined, undefined, 2);
      expect(all.items.map((item) => item.jobHash)).toEqual(["A", "B"]);
      await expect(queries.getFeed(scope, all.nextCursor!, { categoryId: "transformation" }, 2))
        .rejects.toThrow(CursorValidationError);

      const first = await queries.getFeed(scope, undefined, { categoryId: "transformation" }, 2);
      const second = await queries.getFeed(scope, first.nextCursor!, { categoryId: "transformation" }, 2);
      expect(first.items.map((item) => item.jobHash)).toEqual(["A", "C"]);
      expect(second.items.map((item) => item.jobHash)).toEqual(["D"]);
    });

    it("preserves acquisition-unavailable evaluation state through feed and dossier", async () => {
      await seedOpportunity({ jobId: "pending", hash: "pending", title: "Pending", verdict: null, score: null, evalState: "ACQUISITION_PENDING" });
      await seedOpportunity({ jobId: "failed", hash: "failed", title: "Failed", verdict: null, score: null, evalState: "ACQUISITION_FAILED" });

      const scope = { tenantId: "tenant_A", personId: "person_A" };
      const feed = await queries.getFeed(scope, undefined, undefined, 10);
      expect(feed.items.map((item) => [item.jobHash, item.evaluationState, item.engineVerdict])).toEqual([
        ["failed", "ACQUISITION_FAILED", null],
        ["pending", "ACQUISITION_PENDING", null],
      ]);
      expect((await queries.getDossier(scope, "pending"))?.evaluationState).toBe("ACQUISITION_PENDING");
      expect((await queries.getDossier(scope, "failed"))?.evaluationState).toBe("ACQUISITION_FAILED");
    });
  });
});
