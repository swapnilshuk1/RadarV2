import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import {
  authenticateTenantMembership,
  authorizePersonScope,
  TenantIsolationError,
} from "../../src/lib/security/auth";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";

describe("Milestone M8 — Multi-Tenant Isolation & Adversarial Security", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;

  const legitimateTenantId = "tenant_default";
  const legitimateUserId = "user_swapnil";
  const legitimatePersonId = "person_swapnil";
  const adversarialTenantId = "tenant_adversary_corp";
  const foreignPersonId = "person_foreign_target_999";

  beforeEach(() => {
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);

    const migrationFiles = [
      "001_initial_schema.sql",
      "007_auth_tables.sql",
      "009_profile_queryable_columns.sql",
      "018_multi_tenant_foundation.sql",
      "019_evaluation_context_and_read_model.sql",
      "020_canonical_acquisition.sql",
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    // Seed tenants, users, memberships, people
    sqliteDb.exec(`
      INSERT INTO tenants (id, status) VALUES 
        ('${legitimateTenantId}', 'active'),
        ('${adversarialTenantId}', 'active');

      INSERT INTO users (id, email) VALUES 
        ('${legitimateUserId}', 'swapnil@test.com'),
        ('adversary_user', 'adversary@test.com');

      INSERT INTO memberships (user_id, tenant_id, role, permissions, status) VALUES 
        ('${legitimateUserId}', '${legitimateTenantId}', 'admin', '["read:evaluation"]', 'active'),
        ('adversary_user', '${adversarialTenantId}', 'member', '["read:evaluation"]', 'active');

      INSERT INTO people (id, email, tenant_id) VALUES 
        ('${legitimatePersonId}', 'swapnil@test.com', '${legitimateTenantId}'),
        ('${foreignPersonId}', 'foreign@test.com', '${adversarialTenantId}');

      -- Seed active search plan & context for legitimate tenant
      INSERT INTO search_plans (id, tenant_id, person_id, title, criteria_json, status) VALUES 
        ('sp_legit', '${legitimateTenantId}', '${legitimatePersonId}', 'VP Search', '{"targetRoles":["VP Engineering"]}', 'active');

      INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES 
        ('sps_legit', '${legitimateTenantId}', '${legitimatePersonId}', 'sp_legit', 'snap_hash_1', '{"targetRoles":["VP Engineering"]}');

      INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES 
        ('ctx_fp_legit', '${legitimateTenantId}', '${legitimatePersonId}', 'sps_legit', 'v2', 'ofp_1', 'v4.3', 'prof_1');

      -- Seed canonical opportunity & version
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES 
        ('can_job_1', 'LinkedIn', 'job_hash_legit_1', 'https://linkedin.com/jobs/1', 'Acme Corp');

      INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, company_name, location, employment_type, raw_content) VALUES 
        ('ov_1', 'can_job_1', 'chash_1', 'VP Engineering', 'Acme Corp', 'Bengaluru', 'Full-time', 'Job Description content');

      INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES 
        ('${legitimateTenantId}', '${legitimatePersonId}', 'sp_legit', 'can_job_1', 'ov_1', 'CANDIDATE');

      INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, decision, quality_score, rationale, evidence_ids, evaluation_json) VALUES 
        ('me_1', '${legitimateTenantId}', '${legitimatePersonId}', 'can_job_1', 'ov_1', 'ctx_fp_legit', 'PURSUE', 92.5, 'High fit', '[]', '{"jobHash":"job_hash_legit_1","role":"VP Engineering","company":"Acme Corp","location":"Bengaluru","decision":"PURSUE","intrinsicVerdict":"PURSUE","intrinsicQualityScore":92.5,"baseNarrative":{"baseRecommendationProse":"Recommended."}}');
    `);
  });

  it("should successfully authenticate and authorize legitimate tenant and user scope", async () => {
    const authContext = await authenticateTenantMembership(legitimateUserId, legitimateTenantId, db);
    expect(authContext).toBeDefined();
    expect(authContext.userId).toBe(legitimateUserId);
    expect(authContext.tenantId).toBe(legitimateTenantId);

    const scope = await authorizePersonScope(authContext, legitimatePersonId, db);
    expect(scope).toBeDefined();
    expect(scope.tenantId).toBe(legitimateTenantId);
    expect(scope.personId).toBe(legitimatePersonId);
  });

  it("should reject authentication for a tenant where the user has no membership", async () => {
    await expect(
      authenticateTenantMembership(legitimateUserId, adversarialTenantId, db)
    ).rejects.toThrow(TenantIsolationError);
  });

  it("should reject access when a user in one tenant attempts to access a person in another tenant", async () => {
    const authContext = await authenticateTenantMembership(legitimateUserId, legitimateTenantId, db);

    await expect(
      authorizePersonScope(authContext, foreignPersonId, db)
    ).rejects.toThrow(TenantIsolationError);
  });

  it("should ensure canonical queries strictly isolate opportunities between tenants", async () => {
    const store = new SqliteCanonicalServingStore(db);

    // 1. Legitimate scope returns active opportunities
    const legitimateScope = {
      tenantId: legitimateTenantId,
      personId: legitimatePersonId,
    };
    const legitimateOpps = await store.listOpportunities(legitimateScope);
    expect(legitimateOpps.length).toBe(1);
    expect(legitimateOpps[0].jobHash).toBe("job_hash_legit_1");
    expect(legitimateOpps[0].role).toBe("VP Engineering");

    // 2. Synthetic foreign scope returns 0 opportunities
    const foreignScope = {
      tenantId: adversarialTenantId,
      personId: foreignPersonId,
    };
    const foreignOpps = await store.listOpportunities(foreignScope);
    expect(foreignOpps).toHaveLength(0);

    // 3. Synthetic foreign scope single get returns undefined
    const leakAttempt = await store.getOpportunity(foreignScope, "job_hash_legit_1");
    expect(leakAttempt).toBeUndefined();

    // 4. Synthetic foreign scope metrics return 0 screened count
    const foreignMetrics = await store.getOpportunityMetrics(foreignScope);
    expect(foreignMetrics.totalScreened).toBe(0);
    expect(foreignMetrics.activePursuits).toBe(0);
  });

  it("should fail resolveScope when user has no active tenant memberships", async () => {
    const { resolveScope } = await import("../../src/lib/intelligence/opportunity-service");
    // Synthetic orphan user with no memberships
    sqliteDb.exec(`INSERT INTO users (id, email) VALUES ('orphan_user', 'orphan@test.com')`);

    // In unit test environment, getDatabaseAdapter will return Turso or mock, but let's test resolveScope behavior
    // when resolveScope is invoked for a non-existent membership
    await expect(resolveScope("orphan_user")).rejects.toThrow(TenantIsolationError);
  });
});
