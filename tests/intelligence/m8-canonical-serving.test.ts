import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";

describe("Milestone M8 — Canonical Executive Serving Store & Resolution", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;
  let store: SqliteOpportunityQueries;

  const tenantId = "tenant_default";
  const personId = "person_swapnil";
  const scope = { tenantId, personId };

  beforeEach(() => {
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    store = new SqliteOpportunityQueries(db);

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
      "037_materialized_evaluation_fingerprint.sql",
      "038_opportunity_version_category_projection.sql",
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    // Seed tenants, people, search_plans, evaluation_contexts
    sqliteDb.exec(`
      INSERT INTO tenants (id, status) VALUES ('${tenantId}', 'active');
      INSERT INTO users (id, email) VALUES ('${personId}', 'swapnil@test.com');
      INSERT INTO memberships (user_id, tenant_id, role, permissions, status) VALUES
        ('${personId}', '${tenantId}', 'admin', '["*"]', 'active');
      INSERT INTO people (id, email, tenant_id) VALUES ('${personId}', 'swapnil@test.com', '${tenantId}');

      INSERT INTO search_plans (id, tenant_id, person_id, title, criteria_json, status) VALUES 
        ('sp_1', '${tenantId}', '${personId}', 'Executive Search', '{"targetRoles":["CTO","VP Engineering"]}', 'active');

      INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES 
        ('sps_1', '${tenantId}', '${personId}', 'sp_1', 'snap_hash_1', '{"targetRoles":["CTO","VP Engineering"]}');

      INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES 
        ('ctx_fp_1', '${tenantId}', '${personId}', 'sps_1', 'v2', 'ofp_1', 'v4.3', 'prof_1');

      -- Serving authority is explicit; chronology must not choose this context.
      INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id) VALUES
        ('ctx_fp_1', '${tenantId}', '${personId}', 'sp_1');
      INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by) VALUES
        ('${tenantId}', '${personId}', 'sp_1', 'ctx_fp_1', 'test');

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

      INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, company_name, location, employment_type, raw_content, posted_at, posted_precision, lifecycle_state, category_ids) VALUES
        ('ov_1', 'can_1', 'chash_1', 'VP Engineering', 'Acme Corp', 'Bengaluru', 'Full-time', 'VP Eng Role Description', '2026-08-01T00:00:00.000Z', 'EXACT', 'ACTIVE', '[]'),
        ('ov_2', 'can_2', 'chash_2', 'CTO', 'Beta Ltd', 'Remote', 'Full-time', 'CTO Role Description', NULL, 'UNKNOWN', 'ACTIVE', '[]'),
        ('ov_3', 'can_3', 'chash_3', 'Chief Product Officer', 'Gamma Inc', 'Mumbai', 'Full-time', 'CPO Role Description', NULL, 'UNKNOWN', 'ACTIVE', '[]');

      -- Search plan candidates
      INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES 
        ('${tenantId}', '${personId}', 'sp_1', 'can_1', 'ov_1', 'CANDIDATE'),
        ('${tenantId}', '${personId}', 'sp_1', 'can_2', 'ov_2', 'CANDIDATE'),
        ('${tenantId}', '${personId}', 'sp_1', 'can_3', 'ov_3', 'CANDIDATE');

      -- Materialized evaluations (can_1: PURSUE 95, can_2: CONSIDER 80, can_3: PASS 40)
      INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, evaluation_state, decision, quality_score, evaluation_fingerprint, rationale, evidence_ids, evaluation_json) VALUES
        ('me_1', '${tenantId}', '${personId}', 'can_1', 'ov_1', 'ctx_fp_1', 'COMPLETE', 'PURSUE', 95.0, 'fp_1', 'Strong fit', '[]', '{"schemaVersion":"v4.3-intrinsic","evaluationContractVersion":"v4.3","evaluationState":"EVALUATED","evaluationInputHash":"fp_1","canonicalJobId":"can_1","opportunityVersion":"ov_1","jobHash":"hash_1","evaluatedAt":"2026-08-01T00:00:00.000Z","contextFingerprint":"ctx_fp_1","tenantId":"${tenantId}","personId":"${personId}","policyVersion":"v4.3","ontologyVersion":"v2","ontologyFingerprint":"ofp_1","profileVersion":"prof_1","decision":"PURSUE","score":95,"diligenceStatus":"READY","jobProjection":{}}'),
        ('me_2', '${tenantId}', '${personId}', 'can_2', 'ov_2', 'ctx_fp_1', 'COMPLETE', 'CONSIDER', 80.0, 'fp_2', 'Moderate fit', '[]', '{"schemaVersion":"v4.3-intrinsic","evaluationContractVersion":"v4.3","evaluationState":"EVALUATED","evaluationInputHash":"fp_2","canonicalJobId":"can_2","opportunityVersion":"ov_2","jobHash":"hash_2","evaluatedAt":"2026-08-01T00:00:00.000Z","contextFingerprint":"ctx_fp_1","tenantId":"${tenantId}","personId":"${personId}","policyVersion":"v4.3","ontologyVersion":"v2","ontologyFingerprint":"ofp_1","profileVersion":"prof_1","decision":"CONSIDER","score":80,"diligenceStatus":"READY","jobProjection":{}}'),
        ('me_3', '${tenantId}', '${personId}', 'can_3', 'ov_3', 'ctx_fp_1', 'COMPLETE', 'PASS', 40.0, 'fp_3', 'Low fit', '[]', '{"schemaVersion":"v4.3-intrinsic","evaluationContractVersion":"v4.3","evaluationState":"EVALUATED","evaluationInputHash":"fp_3","canonicalJobId":"can_3","opportunityVersion":"ov_3","jobHash":"hash_3","evaluatedAt":"2026-08-01T00:00:00.000Z","contextFingerprint":"ctx_fp_1","tenantId":"${tenantId}","personId":"${personId}","policyVersion":"v4.3","ontologyVersion":"v2","ontologyFingerprint":"ofp_1","profileVersion":"prof_1","decision":"PASS","score":40,"diligenceStatus":"READY","jobProjection":{}}');

      -- Decision recorded for can_2 (User PURSUE override)
      INSERT INTO canonical_decisions (id, tenant_id, person_id, canonical_job_id, action, reason, reviewed_fingerprint) VALUES
        ('dec_1', '${tenantId}', '${personId}', 'can_2', 'PURSUE', 'Great role', 'fp_2');
    `);
  });

  describe("Canonical Serving Queries", () => {
    it("should list candidate opportunities sorted by tier order and score", async () => {
      const opps = (await store.getFeed(scope, undefined, {}, 50)).items;

      expect(opps).toHaveLength(3);
      // Public serving exposes a canonical verdict, not a legacy ranking label.
      expect(opps[0].jobHash).toBe("hash_1");
      expect(opps[0].engineVerdict).toBe("PURSUE");
      expect(opps[0].userAction).toBeNull();
      expect(opps[0].effectiveDecision).toBe("PURSUE");

      // A user action changes only effectiveDecision; the engine verdict remains factual.
      expect(opps[1].jobHash).toBe("hash_2");
      expect(opps[1].engineVerdict).toBe("CONSIDER");
      expect(opps[1].userAction).toBe("PURSUE");
      expect(opps[1].effectiveDecision).toBe("PURSUE");
      expect(opps[1].reviewState).toBe("CURRENT");

      // can_3 has no user decision, so effectiveDecision is the engine PASS.
      expect(opps[2].jobHash).toBe("hash_3");
      expect(opps[2].engineVerdict).toBe("PASS");
      expect(opps[2].effectiveDecision).toBe("PASS");
    });

    it("should retrieve a single opportunity DTO by hash with exact populated metadata", async () => {
      const opp = await store.getDossier(scope, "hash_1");
      expect(opp).toBeDefined();
      expect(opp?.jobHash).toBe("hash_1");
      expect(opp?.role).toBe("VP Engineering");
      expect(opp?.company).toBe("Acme Corp");
      expect(opp?.location).toBe("Bengaluru");
      expect(opp?.effectiveDecision).toBe("PURSUE");
      expect(opp?.applyUrl).toBe("https://linkedin.com/jobs/1");
      expect(opp?.postedRelative).toContain("Posted");
    });

    it("should compute authoritative opportunity metrics", async () => {
      const metrics = await store.getMetrics(scope);

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
      const decided = (await store.getFeed(scope, undefined, { decisionFilter: "decided" }, 50)).items;

      expect(decided).toHaveLength(1);
      expect(decided[0].jobHash).toBe("hash_2");
      expect(decided[0].userAction).toBe("PURSUE");
    });

    it("keeps the canonical feed ordering deterministic", async () => {
      const first = await store.getFeed(scope, undefined, {}, 2);
      expect(first.items.map((item) => item.jobHash)).toEqual(["hash_1", "hash_2"]);
      expect(first.nextCursor).toBeTruthy();

      const second = await store.getFeed(scope, first.nextCursor!, {}, 2);
      expect(second.items.map((item) => item.jobHash)).toEqual(["hash_3"]);
    });

    it("should deterministically deduplicate decisions when multiple ID representations exist", async () => {
      // Insert opportunity row for can_1 if needed for foreign key, plus older & newer decisions
      sqliteDb.exec(`
        INSERT OR IGNORE INTO opportunities (id, company_id, canonical_title, fingerprint, lifecycle) VALUES 
          ('can_1', 'comp_1', 'VP Engineering', 'fp_can1', 'ACTIVE');

        INSERT INTO canonical_decisions (id, tenant_id, person_id, canonical_job_id, action, reason, reviewed_fingerprint, updated_at) VALUES
          ('dec_can1_new', '${tenantId}', '${personId}', 'can_1', 'PURSUE', 'Newer decision', 'fp_1', '2026-01-02T00:00:00Z');
      `);

      const opps = (await store.getFeed(scope, undefined, {}, 50)).items;
      // Row count must remain exactly 3 (no Cartesian explosion)
      expect(opps).toHaveLength(3);

      // can_1 must pick the latest decision ('PURSUE' from 2026-01-02)
      const can1 = opps.find((o) => o.jobHash === "hash_1");
      expect(can1).toBeDefined();
      expect(can1?.userAction).toBe("PURSUE");
      expect(can1?.effectiveDecision).toBe("PURSUE");
    });
  });

});
