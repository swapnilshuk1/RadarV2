import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";
import { resolveEffectiveDecision } from "../../src/lib/intelligence/decision-resolver";

describe("Milestone M8 — Canonical Executive Serving Store & Resolution", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;
  let store: SqliteCanonicalServingStore;

  const tenantId = "tenant_default";
  const personId = "person_swapnil";
  const scope = { tenantId, personId };

  beforeEach(() => {
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    store = new SqliteCanonicalServingStore(db);

    const migrationFiles = [
      "001_initial_schema.sql",
      "002_event_sourcing.sql",
      "006_recreate_decisions.sql",
      "007_auth_tables.sql",
      "009_profile_queryable_columns.sql",
      "018_multi_tenant_foundation.sql",
      "019_evaluation_context_and_read_model.sql",
      "020_canonical_acquisition.sql",
      "023_canonical_posted_at.sql",
      "024_canonical_posting_precision.sql",
      "025_canonical_decisions.sql",
      "026_canonical_acquisition_integrity.sql",
      "027_materialized_evaluations_nullable_decision.sql",
      "028_active_evaluation_context_pointers.sql",
      "029_materialized_evaluations_vetoed.sql",
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    // Seed tenants, people, search_plans, evaluation_contexts
    sqliteDb.exec(`
      INSERT INTO tenants (id, status) VALUES ('${tenantId}', 'active');
      INSERT INTO people (id, email, tenant_id) VALUES ('${personId}', 'swapnil@test.com', '${tenantId}');

      INSERT INTO search_plans (id, tenant_id, person_id, title, criteria_json, status) VALUES 
        ('sp_1', '${tenantId}', '${personId}', 'Executive Search', '{"targetRoles":["CTO","VP Engineering"]}', 'active');

      INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES 
        ('sps_1', '${tenantId}', '${personId}', 'sp_1', 'snap_hash_1', '{"targetRoles":["CTO","VP Engineering"]}');

      INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES 
        ('ctx_fp_1', '${tenantId}', '${personId}', 'sps_1', 'v2', 'ofp_1', 'v4.3', 'prof_1');

      INSERT INTO companies (id, name) VALUES ('comp_1', 'Beta Ltd');
      INSERT INTO opportunities (id, company_id, canonical_title, fingerprint, lifecycle) VALUES 
        ('hash_1', 'comp_1', 'VP Engineering', 'fp_1', 'ACTIVE'),
        ('hash_2', 'comp_1', 'CTO', 'fp_2', 'ACTIVE'),
        ('hash_3', 'comp_1', 'Chief Product Officer', 'fp_3', 'ACTIVE');

      -- Canonical opportunities & versions
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES 
        ('can_1', 'LinkedIn', 'hash_1', 'https://linkedin.com/jobs/1', 'Acme Corp'),
        ('can_2', 'LinkedIn', 'hash_2', 'https://linkedin.com/jobs/2', 'Beta Ltd'),
        ('can_3', 'LinkedIn', 'hash_3', 'https://linkedin.com/jobs/3', 'Gamma Inc');

      INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, company_name, location, employment_type, raw_content, posted_at, posted_precision) VALUES 
        ('ov_1', 'can_1', 'chash_1', 'VP Engineering', 'Acme Corp', 'Bengaluru', 'Full-time', 'VP Eng Role Description', '2026-08-01T00:00:00.000Z', 'EXACT'),
        ('ov_2', 'can_2', 'chash_2', 'CTO', 'Beta Ltd', 'Remote', 'Full-time', 'CTO Role Description', NULL, 'UNKNOWN'),
        ('ov_3', 'can_3', 'chash_3', 'Chief Product Officer', 'Gamma Inc', 'Mumbai', 'Full-time', 'CPO Role Description', NULL, 'UNKNOWN');

      -- Search plan candidates
      INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES 
        ('${tenantId}', '${personId}', 'sp_1', 'can_1', 'ov_1', 'CANDIDATE'),
        ('${tenantId}', '${personId}', 'sp_1', 'can_2', 'ov_2', 'CANDIDATE'),
        ('${tenantId}', '${personId}', 'sp_1', 'can_3', 'ov_3', 'CANDIDATE');

      -- Materialized evaluations (can_1: PURSUE 95, can_2: CONSIDER 80, can_3: PASS 40)
      INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, decision, quality_score, rationale, evidence_ids, evaluation_json) VALUES 
        ('me_1', '${tenantId}', '${personId}', 'can_1', 'ov_1', 'ctx_fp_1', 'PURSUE', 95.0, 'Strong fit', '[]', '{"jobHash":"hash_1","role":"VP Engineering","company":"Acme Corp","location":"Bengaluru","decision":"PURSUE","intrinsicVerdict":"PURSUE","intrinsicQualityScore":95.0,"baseNarrative":{"baseRecommendationProse":"Strong alignment."}}'),
        ('me_2', '${tenantId}', '${personId}', 'can_2', 'ov_2', 'ctx_fp_1', 'CONSIDER', 80.0, 'Moderate fit', '[]', '{"jobHash":"hash_2","role":"CTO","company":"Beta Ltd","location":"Remote","decision":"CONSIDER","intrinsicVerdict":"CONSIDER","intrinsicQualityScore":80.0,"baseNarrative":{"baseRecommendationProse":"Moderate alignment."}}'),
        ('me_3', '${tenantId}', '${personId}', 'can_3', 'ov_3', 'ctx_fp_1', 'PASS', 40.0, 'Low fit', '[]', '{"jobHash":"hash_3","role":"Chief Product Officer","company":"Gamma Inc","location":"Mumbai","decision":"PASS","intrinsicVerdict":"PASS","intrinsicQualityScore":40.0,"baseNarrative":{"baseRecommendationProse":"Pass."}}');

      -- Decision recorded for can_2 (User PURSUE override)
      INSERT INTO canonical_decisions (id, tenant_id, person_id, canonical_job_id, action, reason) VALUES 
        ('dec_1', '${tenantId}', '${personId}', 'can_2', 'PURSUE', 'Great role');
    `);
  });

  describe("Canonical Serving Queries", () => {
    it("should list candidate opportunities sorted by tier order and score", async () => {
      const opps = await store.listOpportunities(scope);

      expect(opps).toHaveLength(3);
      // can_1 (ENGINE_PURSUIT - Tier 1)
      expect(opps[0].jobHash).toBe("hash_1");
      expect(opps[0].effectiveDecision).toBe("ENGINE_PURSUIT");

      // can_2 (PREFERENCE_OVERRIDE: User PURSUE + Engine CONSIDER - Tier 2)
      expect(opps[1].jobHash).toBe("hash_2");
      expect(opps[1].effectiveDecision).toBe("PREFERENCE_OVERRIDE");
      expect(opps[1].userDecision?.userAction).toBe("PURSUE");

      // can_3 (ENGINE_PASS - Tier 5)
      expect(opps[2].jobHash).toBe("hash_3");
      expect(opps[2].effectiveDecision).toBe("ENGINE_PASS");
    });

    it("should retrieve a single opportunity DTO by hash with exact populated metadata", async () => {
      const opp = await store.getOpportunity(scope, "hash_1");
      expect(opp).toBeDefined();
      expect(opp?.jobHash).toBe("hash_1");
      expect(opp?.role).toBe("VP Engineering");
      expect(opp?.company).toBe("Acme Corp");
      expect(opp?.location).toBe("Bengaluru");
      expect(opp?.effectiveDecision).toBe("ENGINE_PURSUIT");
      expect(opp?.applyUrl).toBe("https://linkedin.com/jobs/1");
      expect(opp?.postedRelative).toContain("Posted");
    });

    it("should compute authoritative opportunity metrics", async () => {
      const metrics = await store.getOpportunityMetrics(scope);

      expect(metrics).toBeDefined();
      expect(metrics.personId).toBe(personId);
      expect(metrics.totalScreened).toBe(3);
      expect(metrics.totalDecisions).toBe(1);
      expect(metrics.remainingToReview).toBe(2);
      expect(metrics.engineBreakdown.pursue).toBe(1);
      expect(metrics.engineBreakdown.consider).toBe(1);
      expect(metrics.engineBreakdown.pass).toBe(1);
      expect(metrics.integrity.status).toBe("PASS");
    });

    it("should list decided opportunities for user correctly", async () => {
      const decided = await store.listDecidedOpportunities(scope);

      expect(decided).toHaveLength(1);
      expect(decided[0].jobHash).toBe("hash_2");
      expect(decided[0].userDecision?.userAction).toBe("PURSUE");
    });

    it("should navigate adjacent opportunities deterministically", async () => {
      const adj1 = await store.getAdjacentOpportunities(scope, "hash_1");
      expect(adj1.currentIndex).toBe(1);
      expect(adj1.totalCount).toBe(3);
      expect(adj1.prev).toBeUndefined();
      expect(adj1.next?.jobHash).toBe("hash_2");

      const adj2 = await store.getAdjacentOpportunities(scope, "hash_2");
      expect(adj2.currentIndex).toBe(2);
      expect(adj2.prev?.jobHash).toBe("hash_1");
      expect(adj2.next?.jobHash).toBe("hash_3");

      const adj3 = await store.getAdjacentOpportunities(scope, "hash_3");
      expect(adj3.currentIndex).toBe(3);
      expect(adj3.prev?.jobHash).toBe("hash_2");
      expect(adj3.next).toBeUndefined();
    });

    it("should deterministically deduplicate decisions when multiple ID representations exist", async () => {
      // Insert opportunity row for can_1 if needed for foreign key, plus older & newer decisions
      sqliteDb.exec(`
        INSERT OR IGNORE INTO opportunities (id, company_id, canonical_title, fingerprint, lifecycle) VALUES 
          ('can_1', 'comp_1', 'VP Engineering', 'fp_can1', 'ACTIVE');

        INSERT INTO canonical_decisions (id, tenant_id, person_id, canonical_job_id, action, reason, updated_at) VALUES 
          ('dec_can1_new', '${tenantId}', '${personId}', 'can_1', 'PURSUE', 'Newer decision', '2026-01-02T00:00:00Z');
      `);

      const opps = await store.listOpportunities(scope);
      // Row count must remain exactly 3 (no Cartesian explosion)
      expect(opps).toHaveLength(3);

      // can_1 must pick the latest decision ('PURSUE' from 2026-01-02)
      const can1 = opps.find((o) => o.jobHash === "hash_1");
      expect(can1).toBeDefined();
      expect(can1?.userDecision?.userAction).toBe("PURSUE");
      expect(can1?.userDecision?.updatedAt).toBe("2026-01-02T00:00:00Z");
      expect(can1?.effectiveDecision).toBe("USER_CONFIRMED");
    });
  });

  describe("Effective Decision Precedence Truth Table", () => {
    it("should adhere strictly to the canonical effective decision truth table precedence", () => {
      // 1. User PASS always results in USER_PASSED
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PURSUE",
        userAction: "PASS",
      })).toBe("USER_PASSED");

      // 2. User PURSUE + Engine PURSUE -> USER_CONFIRMED
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PURSUE",
        userAction: "PURSUE",
      })).toBe("USER_CONFIRMED");

      // 3. User PURSUE + Engine CONSIDER -> PREFERENCE_OVERRIDE
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "CONSIDER",
        userAction: "PURSUE",
      })).toBe("PREFERENCE_OVERRIDE");

      // 4. User PURSUE + Engine PASS/Veto -> VETO_OVERRIDE
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PASS",
        userAction: "PURSUE",
      })).toBe("VETO_OVERRIDE");

      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PURSUE",
        vetoed: true,
        userAction: "PURSUE",
      })).toBe("VETO_OVERRIDE");

      // 5. User CONSIDER + Engine CONSIDER -> ENGINE_CONSIDER
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "CONSIDER",
        userAction: "CONSIDER",
      })).toBe("ENGINE_CONSIDER");

      // 6. User CONSIDER + Engine PASS/PURSUE -> PREFERENCE_OVERRIDE
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PASS",
        userAction: "CONSIDER",
      })).toBe("PREFERENCE_OVERRIDE");

      // 7. NOT_CANDIDATE with no user action -> NOT_EVALUABLE
      expect(resolveEffectiveDecision({
        attentionDecision: "NOT_CANDIDATE",
        engineVerdict: "PURSUE",
        userAction: "NONE",
      })).toBe("NOT_EVALUABLE");

      // 8. No user action + Engine verdicts
      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PURSUE",
        userAction: "NONE",
      })).toBe("ENGINE_PURSUIT");

      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "CONSIDER",
        userAction: "NONE",
      })).toBe("ENGINE_CONSIDER");

      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "PASS",
        userAction: "NONE",
      })).toBe("ENGINE_PASS");

      expect(resolveEffectiveDecision({
        attentionDecision: "CANDIDATE",
        engineVerdict: "SPARSE_SPEC",
        userAction: "NONE",
      })).toBe("NOT_EVALUABLE");
    });
  });
});
