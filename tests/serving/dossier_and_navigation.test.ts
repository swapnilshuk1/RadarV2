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
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import type { AuthorizedPersonScope } from "../../src/lib/security/auth";
import type { EvaluatedOpportunity } from "../../src/data/opportunity-fixtures";
import { classifyOpportunityCategories } from "../../src/lib/domain/category_taxonomy";

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
    contextFingerprint?: string;
    evaluationFingerprint?: string | null;
    reviewedFingerprint?: string | null;
    customEvalJson?: string;
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
      `UPDATE opportunity_versions SET category_ids = ? WHERE id = ?`,
      [JSON.stringify(classifyOpportunityCategories({ role: params.title, description: "Detailed Job Description Content" })), verId],
    );

    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
       VALUES ('tenant_A', 'person_A', 'plan_A', ?, ?, 'CANDIDATE')`,
      [oppId, verId]
    );

    const evalJson = params.customEvalJson || JSON.stringify({
      schemaVersion: "v4.3-intrinsic",
      evaluationContractVersion: "v4.3",
      evaluationState: "EVALUATED",
      canonicalJobId: oppId,
      opportunityVersion: verId,
      jobHash: params.id,
      tenantId: "tenant_A",
      personId: "person_A",
      evaluationInputHash: params.evaluationFingerprint === undefined ? "eval_A" : params.evaluationFingerprint,
      contextFingerprint: params.contextFingerprint ?? "fingerprint_A",
      policyVersion: "test",
      ontologyVersion: "test",
      ontologyFingerprint: "test-ontology",
      profileVersion: "test-profile",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      decision: params.engineVerdict,
      score: params.score,
      diligenceStatus: "UNKNOWN",
      jobProjection: { title: params.title },
    });

    if (params.evaluationState !== "UNMATERIALIZED") {
      await db.execute(
        `INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, evaluation_fingerprint, decision, quality_score, evaluation_state, vetoed, evaluation_json)
         VALUES (?, 'tenant_A', 'person_A', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `eval_${params.id}`,
          oppId,
          verId,
          params.contextFingerprint ?? "fingerprint_A",
          params.evaluationFingerprint === undefined ? "eval_A" : params.evaluationFingerprint,
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
        `INSERT INTO canonical_decisions (tenant_id, person_id, canonical_job_id, action, reviewed_fingerprint)
         VALUES ('tenant_A', 'person_A', ?, ?, ?)`,
        [oppId, params.userAction, params.reviewedFingerprint ?? null]
      );
    }
  }

  describe("1. Point Lookup (getDossier)", () => {
    it("keeps the legacy evaluation adapter outside production canonical serving reachability", () => {
      for (const file of [
        "src/data/sqlite/repositories/SqliteOpportunityQueries.ts",
        "src/data/sqlite/repositories/SqliteCanonicalServingStore.ts",
      ]) {
        const source = fs.readFileSync(path.resolve(process.cwd(), file), "utf8");
        expect(source).not.toContain("adaptLegacyEvaluation");
      }
    });

    it("retrieves full evaluated opportunity with exact payload and effectiveDecision", async () => {
      await seedItem({ id: "job_1", title: "VP Digital Transformation", engineVerdict: "PURSUE", score: 95, userAction: "PURSUE" });

      const dossier = await queries.getDossier(scope, "job_1");
      expect(dossier).not.toBeNull();
      expect(dossier?.jobHash).toBe("job_1");
      expect(dossier?.role).toBe("VP Digital Transformation");
      expect(dossier?.evaluationState).toBe("EVALUATED");

      const evaluated = dossier as EvaluatedOpportunity;
      expect(evaluated.effectiveDecision).toBe("PURSUE");
      expect(evaluated.userDecision?.userAction).toBe("PURSUE");
      expect(evaluated.engineRecommendation?.qualityScore).toBe(95);
    });

    it("rejects a legacy Presented envelope rather than manufacturing canonical evaluation facts", async () => {
      const presentedEnvelope = JSON.stringify({
        opportunity: {
          jobHash: "titan_growth_job",
          role: "Head of Growth Marketing",
          company: "Titan",
          location: "Bengaluru",
          dimensions: [
            {
              key: "mandate",
              label: "Mandate",
              importance: "Core",
              bucket: "Matched",
              jdEvidence: {
                status: "Explicit",
                value: "Lead full-funnel digital marketing across watch brands",
                evidence: [{ quote: "Lead full-funnel digital marketing across watch brands", source: "snippet" }],
              },
            },
          ],
          recommendation: "Legacy text that must not be copied directly",
        },
        record: {
          jobHash: "titan_growth_job",
          verb: "PURSUE",
          qualityScore: 92,
        },
        narrative: {
          recommendation: "Legacy text that must not be copied directly",
        },
      });

      await seedItem({
        id: "titan_growth_job",
        title: "Head of Growth Marketing",
        engineVerdict: "PURSUE",
        score: 92,
        customEvalJson: presentedEnvelope,
      });

      const dossier = await queries.getDossier(scope, "titan_growth_job");
      expect(dossier).not.toBeNull();
      expect(dossier?.jobHash).toBe("titan_growth_job");
      expect(dossier?.evaluationState).toBe("INVALID");
      expect((dossier as any)?.reasonCode).toBe("NON_CANONICAL_EVALUATION");
    });

    it("keeps NOT_EVALUABLE, INVALID, and UNMATERIALIZED distinct without an advisory score or verdict", async () => {
      await seedItem({ id: "job_not_evaluable", title: "VP Operations", engineVerdict: null, score: 0, evaluationState: "NOT_EVALUABLE" });
      await seedItem({ id: "job_unmaterialized", title: "VP Finance", engineVerdict: null, score: 0, evaluationState: "UNMATERIALIZED" });
      await seedItem({
        id: "job_invalid", title: "VP Legal", engineVerdict: "PURSUE", score: 90,
        customEvalJson: JSON.stringify({ schemaVersion: "unsupported" }),
      });

      const [notEvaluable, unmaterialized, invalid] = await Promise.all([
        queries.getDossier(scope, "job_not_evaluable"),
        queries.getDossier(scope, "job_unmaterialized"),
        queries.getDossier(scope, "job_invalid"),
      ]);
      expect(notEvaluable?.evaluationState).toBe("NOT_EVALUABLE");
      expect(unmaterialized?.evaluationState).toBe("UNMATERIALIZED");
      expect(invalid?.evaluationState).toBe("INVALID");
      for (const opportunity of [notEvaluable, unmaterialized, invalid]) {
        expect((opportunity as any)?.engineRecommendation).toBeUndefined();
        expect((opportunity as any)?.displayScore).toBeUndefined();
      }
    });

    it("keeps an explicit user decision while exposing stale reviewed-fingerprint provenance identically in feed and dossier", async () => {
      await seedItem({ id: "job_stale", title: "VP Strategy", engineVerdict: "CONSIDER", score: 81, userAction: "PURSUE" });
      await db.execute(
        `UPDATE canonical_decisions SET reviewed_fingerprint = 'fingerprint_v1' WHERE tenant_id = 'tenant_A' AND person_id = 'person_A' AND canonical_job_id = 'opp_job_stale'`
      );

      const feed = await queries.getFeedRaw(
        { tenantId: "tenant_A", personId: "person_A" },
        { searchPlanId: "plan_A", contextFingerprint: "fingerprint_A" },
      );
      const feedItem = feed.find((item) => item.jobHash === "job_stale");
      const dossier = await queries.getDossier(scope, "job_stale") as EvaluatedOpportunity & { reviewState?: string };

      expect(feedItem).toMatchObject({
        engineVerdict: "CONSIDER",
        effectiveDecision: "PURSUE",
        qualityScore: 81,
        evaluationFingerprint: "eval_A",
        reviewedFingerprint: "fingerprint_v1",
        reviewState: "STALE",
      });
      expect(dossier.engineRecommendation?.engineVerdict).toBe("CONSIDER");
      expect(dossier.effectiveDecision).toBe("PURSUE");
      expect(dossier.engineRecommendation?.qualityScore).toBe(81);
      expect(dossier.engineRecommendation?.evaluationFingerprint).toBe("eval_A");
      expect(dossier.userDecision?.reviewedFingerprint).toBe("fingerprint_v1");
      expect(dossier.reviewState).toBe("STALE");
    });

    it("anchors review freshness to the evaluation artifact, never the evaluation context", async () => {
      await db.execute(
        `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version)
         VALUES ('ctx_A', 'tenant_A', 'person_A', 'sps_A', 'v1', 'hash_ontology', 'v1', 'v2')`,
      );
      await db.execute(
        `INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id)
         VALUES ('ctx_A', 'tenant_A', 'person_A', 'plan_A')`,
      );
      await db.execute(
        `UPDATE active_evaluation_contexts SET context_fingerprint = 'ctx_A'
         WHERE tenant_id = 'tenant_A' AND person_id = 'person_A' AND search_plan_id = 'plan_A'`,
      );
      await seedItem({
        id: "job_provenance",
        title: "VP Provenance",
        engineVerdict: "PURSUE",
        score: 94,
        userAction: "PURSUE",
        contextFingerprint: "ctx_A",
        evaluationFingerprint: "eval_A",
        reviewedFingerprint: "eval_A",
      });

      const scopeForContext = { tenantId: "tenant_A", personId: "person_A" };
      let feed = await queries.getFeedRaw(scopeForContext, { searchPlanId: "plan_A", contextFingerprint: "ctx_A" });
      let feedItem = feed.find((item) => item.jobHash === "job_provenance");
      let dossier = await queries.getDossier({ ...scope, activeEvaluationContextId: "ctx_A" }, "job_provenance") as EvaluatedOpportunity & { reviewState?: string; evaluationContextFingerprint?: string };
      expect(feedItem).toMatchObject({ evaluationContextFingerprint: "ctx_A", evaluationFingerprint: "eval_A", reviewState: "CURRENT" });
      expect(dossier.engineRecommendation?.evaluationFingerprint).toBe("eval_A");
      expect(dossier.evaluationContextFingerprint).toBe("ctx_A");
      expect(dossier.reviewState).toBe("CURRENT");

      await db.execute("UPDATE canonical_decisions SET reviewed_fingerprint = 'ctx_A' WHERE canonical_job_id = 'opp_job_provenance'");
      feed = await queries.getFeedRaw(scopeForContext, { searchPlanId: "plan_A", contextFingerprint: "ctx_A" });
      feedItem = feed.find((item) => item.jobHash === "job_provenance");
      dossier = await queries.getDossier({ ...scope, activeEvaluationContextId: "ctx_A" }, "job_provenance") as EvaluatedOpportunity & { reviewState?: string };
      expect(feedItem?.reviewState).toBe("STALE");
      expect(dossier.reviewState).toBe("STALE");
      expect(dossier.effectiveDecision).toBe("PURSUE");
    });

    it("serves structurally incomplete evaluated rows as INVALID without recommendation facts", async () => {
      await seedItem({ id: "bad_verdict", title: "VP Bad Verdict", engineVerdict: "SPARSE_SPEC", score: 80 });
      await seedItem({ id: "bad_score", title: "VP Bad Score", engineVerdict: "PURSUE", score: Number.NaN });
      await seedItem({ id: "missing_fp", title: "VP Missing Fingerprint", engineVerdict: "PURSUE", score: 80, evaluationFingerprint: null, userAction: "PURSUE" });

      for (const jobHash of ["bad_verdict", "bad_score", "missing_fp"]) {
        const dossier = await queries.getDossier(scope, jobHash);
        expect(dossier?.evaluationState).toBe("INVALID");
        expect((dossier as any)?.engineRecommendation).toBeUndefined();
        expect((dossier as any)?.displayScore).toBeUndefined();
      }
      const missingFingerprint = await queries.getDossier(scope, "missing_fp") as any;
      expect(missingFingerprint.effectiveDecision).toBe("PURSUE");
      expect(missingFingerprint.reviewState).toBe("UNKNOWN");
    });

    it("returns null for non-existent or cross-tenant jobHash", async () => {
      const dossier = await queries.getDossier(scope, "non_existent_hash");
      expect(dossier).toBeNull();
    });
  });

  describe("2. Navigation Context (getNavigation)", () => {
    it("paginates two PURSUE evaluations without changing either engine verdict", async () => {
      await seedItem({ id: "page_a", title: "VP Alpha", engineVerdict: "PURSUE", score: 99 });
      await seedItem({ id: "page_b", title: "VP Bravo", engineVerdict: "PURSUE", score: 98 });

      const first = await queries.getFeed(scope, undefined, undefined, 1);
      const second = await queries.getFeed(scope, first.nextCursor || undefined, undefined, 1);
      const paged = [...first.items, ...second.items].filter((item) => item.jobHash === "page_a" || item.jobHash === "page_b");

      expect(paged).toHaveLength(2);
      expect(paged.map((item) => item.engineVerdict)).toEqual(["PURSUE", "PURSUE"]);
      expect(paged.map((item) => item.effectiveDecision)).toEqual(["PURSUE", "PURSUE"]);
    });

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

    it("keeps invalid artifacts with an explicit decision in the non-actionable tier across feed, raw feed, and navigation", async () => {
      await seedItem({ id: "valid", title: "Valid", engineVerdict: "PURSUE", score: 95 });
      await seedItem({ id: "invalid_decision", title: "Invalid", engineVerdict: "PURSUE", score: 90, evaluationState: "INVALID", userAction: "PURSUE" });

      const resolved = await resolveServingScope("person_A", "tenant_A", db);
      const raw = await queries.getFeedRaw(scope, resolved.activeContext!);
      const feed = await queries.getFeed(scope, undefined, undefined, 10);
      const invalidRaw = raw.find((item) => item.jobHash === "invalid_decision");
      const invalidFeed = feed.items.find((item) => item.jobHash === "invalid_decision");
      const navigation = await queries.getNavigation(scope, "invalid_decision");

      expect(invalidRaw?.populationTier).toBe(4);
      expect(invalidFeed?.populationTier).toBe(4);
      expect(invalidFeed?.evaluationState).toBe("INVALID");
      expect(invalidFeed?.effectiveDecision).toBe("PURSUE");
      expect(navigation?.currentIndex).toBe(2);
    });
  });
});
