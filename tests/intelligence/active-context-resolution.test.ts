import { describe, it, expect, beforeAll } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import Database from "better-sqlite3";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";

describe("Active Context Resolution", () => {
  let db: any;
  let store: SqliteCanonicalServingStore;

  beforeAll(async () => {
    const rawDb = new Database(":memory:");
    db = new SqliteAdapter(rawDb);
    
    // Initialize schema using standard fixture
    await setupLineageTestFixture(db);
    
    store = new SqliteCanonicalServingStore(db);
  });

  it("1. selects an active search plan over an inactive one, regardless of age", async () => {
    // Insert an inactive plan for tenant_A
    await db.execute(
      `INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["plan_inactive", "tenant_A", "person_A", "archived", "Inactive Plan", "{}"]
    );
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_inactive", "tenant_A", "person_A", "plan_inactive", "hashInactive", "{}"]
    );
    // Make this context artificially newer (2030)
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      ["fingerprint_inactive_new", "tenant_A", "person_A", "sps_inactive", "v1", "hash_ontology", "v1", "v1", "2030-01-01 12:00:00"]
    );

    const context = await store.getActiveContext({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    // Should still resolve to fingerprint_A from the active plan_A in the fixture, ignoring the 2030 timestamp of the inactive plan.
    expect(context?.contextFingerprint).toBe("fingerprint_A");
    expect(context?.searchPlanId).toBe("plan_A");
  });

  it("2 & 3. respects tenant and person isolation", async () => {
    // tenant_B / person_B asks for context
    // In fixture, they have a plan_B but no snapshot/context yet. Let's add one.
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_B", "tenant_B", "person_B", "plan_B", "hashB", "{}"]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      ["fingerprint_B", "tenant_B", "person_B", "sps_B", "v1", "hash_ontology", "v1", "v1", "2025-01-01 12:00:00"]
    );

    const contextB = await store.getActiveContext({ tenantId: "tenant_B", personId: "person_B", roles: [] });
    expect(contextB?.contextFingerprint).toBe("fingerprint_B");
    
    // A completely empty tenant/person should get undefined
    const contextEmpty = await store.getActiveContext({ tenantId: "tenant_C", personId: "person_C", roles: [] });
    expect(contextEmpty).toBeUndefined();
  });

  it("4. selects the newest created_at context for the same active lineage", async () => {
    // Add two more contexts to plan_A (which is active)
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_A2", "tenant_A", "person_A", "plan_A", "hashA2", "{}"]
    );
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_A3", "tenant_A", "person_A", "plan_A", "hashA3", "{}"]
    );

    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      ["fingerprint_A_older", "tenant_A", "person_A", "sps_A2", "v1", "hash_ontology", "v1", "v1", "2032-01-01 10:00:00"]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      ["fingerprint_A_newest", "tenant_A", "person_A", "sps_A3", "v1", "hash_ontology", "v1", "v1", "2032-01-01 12:00:00"]
    );

    await store.bindEvaluationContextScope("fingerprint_A_newest", "tenant_A", "person_A", "plan_A");
    await store.activateContextPointer("fingerprint_A_newest", "tenant_A", "person_A", "plan_A");

    const context = await store.getActiveContext({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    expect(context?.contextFingerprint).toBe("fingerprint_A_newest");
  });

  it("5. selected context fingerprint is used by serving queries", async () => {
    // Insert a dummy job and an evaluation tied to fingerprint_A_newest.
    await db.execute(`INSERT INTO companies (id, name) VALUES (?, ?)`, ["comp_1", "Company"]);
    await db.execute(
      `INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES (?, ?, ?, ?, ?)`,
      ["job_1", "source", "source_job_1", "url", "Company"]
    );
    await db.execute(
      `INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content, acquisition_status, lifecycle_state) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["v1", "job_1", "hash", "Title", "{}", "ACQUIRED", "ACTIVE"]
    );
    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, ?, ?)`,
      ["tenant_A", "person_A", "plan_A", "job_1", "v1", "CANDIDATE"]
    );

    // Provide materialized evaluation for fingerprint_A_newest (the current active context)
    const payload = JSON.stringify({
      schemaVersion: "v4.3-intrinsic",
      evaluationContractVersion: "v4.3",
      evaluationState: "EVALUATED",
      canonicalJobId: "job_1",
      opportunityVersion: "v1",
      jobHash: "source_job_1",
      tenantId: "tenant_A",
      personId: "person_A",
      evaluationInputHash: "eval_hash_1",
      contextFingerprint: "fingerprint_A_newest",
      policyVersion: "v1",
      ontologyVersion: "v1",
      ontologyFingerprint: "hash_ontology",
      profileVersion: "v1",
      evaluatedAt: "2026-01-01T00:00:00.000Z",
      decision: "PURSUE",
      score: 100,
      diligenceStatus: "UNKNOWN",
      jobProjection: { title: "Title" },
    });

    await db.execute(
      `INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, evaluation_fingerprint, decision, quality_score, evaluation_state, evaluation_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ["mat_1", "tenant_A", "person_A", "job_1", "v1", "fingerprint_A_newest", "eval_hash_1", "PURSUE", 100, "EVALUATED", payload]
    );

    // Call serving store
    const opps = await store.listOpportunities({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    
    expect(opps.length).toBe(1);
    expect(opps[0].evaluationState).toBe("EVALUATED");
    
    // Also test getOpportunity
    const singleOpp = await store.getOpportunity({ tenantId: "tenant_A", personId: "person_A", roles: [] }, "source_job_1");
    expect(singleOpp).toBeDefined();
    expect(singleOpp?.evaluationState).toBe("EVALUATED");
  });

  it("6. ignores newer contexts belonging to other search-plans/persons/tenants", async () => {
    // Insert an ultra-new context for tenant_B, plan_B (which is active)
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_B2", "tenant_B", "person_B", "plan_B", "hashB2", "{}"]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      ["fingerprint_B_super_new", "tenant_B", "person_B", "sps_B2", "v1", "hash_ontology", "v1", "v1", "2035-01-01 12:00:00"]
    );

    // If person_A requests context, they should STILL get fingerprint_A_newest, despite B's 2035 context
    const contextA = await store.getActiveContext({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    expect(contextA?.contextFingerprint).toBe("fingerprint_A_newest");
  });
});
