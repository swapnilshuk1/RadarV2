import { describe, it, expect, beforeAll } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import Database from "better-sqlite3";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";
import { setupLineageTestFixture } from "./lineage_fixture";

describe("getActiveContext and getRematerialisationManifest", () => {
  let db: any;
  let store: SqliteCanonicalServingStore;

  beforeAll(async () => {
    const rawDb = new Database(":memory:");
    db = new SqliteAdapter(rawDb);
    await setupLineageTestFixture(db);
    store = new SqliteCanonicalServingStore(db);
  });

  it("returns historical fallback context when no pointer exists", async () => {
    const context = await store.getActiveContext({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    expect(context?.contextFingerprint).toBe("fingerprint_A");
  });

  it("returns active pointer context when explicit pointer is activated (precedence over fallback)", async () => {
    // create a new snapshot and context
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_A_2", "tenant_A", "person_A", "plan_A", "hashA2", "{}"]
    );
    // Use an explicit newer created_at timestamp
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+1 hour'))`, 
      ["fingerprint_A_2", "tenant_A", "person_A", "sps_A_2", "v1", "hash_ontology", "v1", "v1"]
    );
    
    // Check fallback BEFORE activating pointer (should be fingerprint_A_2 because of DESC order on created_at)
    const fbContext = await store.getActiveContext({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    expect(fbContext?.contextFingerprint).toBe("fingerprint_A_2");

    // To explicitly test pointer priority, let's activate the OLD fingerprint_A.
    await store.bindEvaluationContextScope("fingerprint_A", "tenant_A", "person_A", "plan_A");
    await store.activateContextPointer("fingerprint_A", "tenant_A", "person_A", "plan_A");

    // Even though fingerprint_A_2 is newer in evaluation_contexts, pointer points to fingerprint_A
    const context = await store.getActiveContext({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    expect(context?.contextFingerprint).toBe("fingerprint_A");
    
    // Switch pointer to A_2
    await store.bindEvaluationContextScope("fingerprint_A_2", "tenant_A", "person_A", "plan_A");
    await store.activateContextPointer("fingerprint_A_2", "tenant_A", "person_A", "plan_A");
    const newContext = await store.getActiveContext({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    expect(newContext?.contextFingerprint).toBe("fingerprint_A_2");
  });

  it("calculates rematerialisation manifest correctly", async () => {
    // 1. Setup an active candidate and opportunity
    await db.execute(
      `INSERT INTO companies (id, name) VALUES (?, ?)`,
      ["comp_1", "Company"]
    );
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

    let manifest = await store.getRematerialisationManifest("fingerprint_A_2", "tenant_A", "person_A", "plan_A");
    expect(manifest.totalActiveOpportunities).toBe(1);
    expect(manifest.materializedCount).toBe(0);
    expect(manifest.coveragePercentage).toBe(0);
    expect(manifest.isReady).toBe(false);

    // Insert a materialized evaluation
    await db.execute(
      `INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, evaluation_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["mat_1", "tenant_A", "person_A", "job_1", "v1", "fingerprint_A_2", "{}"]
    );

    manifest = await store.getRematerialisationManifest("fingerprint_A_2", "tenant_A", "person_A", "plan_A");
    expect(manifest.totalActiveOpportunities).toBe(1);
    expect(manifest.materializedCount).toBe(1);
    expect(manifest.coveragePercentage).toBe(100);
    expect(manifest.isReady).toBe(true);
  });

  it("provides deterministic legacy fallback during context collision", async () => {
    // Create two contexts with identical created_at
    const collisionTime = "2026-01-01 12:00:00";
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_coll_1", "tenant_A", "person_A", "plan_A", "hashColl1", "{}"]
    );
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_coll_2", "tenant_A", "person_A", "plan_A", "hashColl2", "{}"]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      ["fingerprint_coll_1", "tenant_A", "person_A", "sps_coll_1", "v1", "hash_ontology", "v1", "v1", collisionTime]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      ["fingerprint_coll_2", "tenant_A", "person_A", "sps_coll_2", "v1", "hash_ontology", "v1", "v1", collisionTime]
    );
    
    // With created_at collision, fingerprint_coll_2 DESC beats fingerprint_coll_1 DESC.
    const futureTime = "2029-01-01 12:00:00";
    await db.execute(
      `UPDATE evaluation_contexts SET created_at = ? WHERE context_fingerprint IN ('fingerprint_coll_1', 'fingerprint_coll_2')`,
      [futureTime]
    );

    // Deactivate explicit pointers by deleting them so we can test fallback
    await db.execute(`DELETE FROM active_evaluation_contexts`);

    const context = await store.getActiveContext({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    expect(context?.contextFingerprint).toBe("fingerprint_coll_2");
  });

  it("leaves active pointer unchanged on invalid activation attempt", async () => {
    // tenant_B and plan_B are already in the fixture. Just add snapshot and valid context.
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_B", "tenant_B", "person_B", "plan_B", "hashB", "{}"]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
      ["fingerprint_valid", "tenant_B", "person_B", "sps_B", "v1", "hash_ontology", "v1", "v1"]
    );

    await store.bindEvaluationContextScope("fingerprint_valid", "tenant_B", "person_B", "plan_B");
    await store.activateContextPointer("fingerprint_valid", "tenant_B", "person_B", "plan_B");

    const success = await store.activateContextPointer("fingerprint_invalid", "tenant_B", "person_B", "plan_B");
    expect(success).toBe(false);

    const pointerRow = await db.one<{ context_fingerprint: string }>(`SELECT context_fingerprint FROM active_evaluation_contexts WHERE tenant_id = 'tenant_B'`);
    expect(pointerRow?.context_fingerprint).toBe("fingerprint_valid");
  });

  it("strictly isolates rematerialisation manifest from legacy history", async () => {
    await db.execute(
      `INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES (?, ?, ?, ?, ?)`,
      ["job_legacy", "source", "source_job_legacy", "url", "Company"]
    );
    await db.execute(
      `INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content, acquisition_status, lifecycle_state) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["v_legacy", "job_legacy", "hash", "Title", "{}", "ACQUIRED", "ACTIVE"]
    );
    await db.execute(
      `INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, ?, ?)`,
      ["tenant_B", "person_B", "plan_B", "job_legacy", "v_legacy", "CANDIDATE"]
    );

    // Create a dummy context for the legacy fingerprint to satisfy FK
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_B_old", "tenant_B", "person_B", "plan_B", "hashB_old", "{}"]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
      ["fingerprint_old_legacy", "tenant_B", "person_B", "sps_B_old", "v0", "hash_ontology_old", "v0", "v0"]
    );

    await db.execute(
      `INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, evaluation_json) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ["mat_legacy", "tenant_B", "person_B", "job_legacy", "v_legacy", "fingerprint_old_legacy", "{}"]
    );

    const manifest = await store.getRematerialisationManifest("fingerprint_valid", "tenant_B", "person_B", "plan_B");
    
    expect(manifest.totalActiveOpportunities).toBe(1);
    expect(manifest.materializedCount).toBe(0);
    expect(manifest.coveragePercentage).toBe(0);
    expect(manifest.isReady).toBe(false);
  });
});
