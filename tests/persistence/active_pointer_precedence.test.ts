import { describe, it, expect, beforeAll } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import Database from "better-sqlite3";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";
import { setupLineageTestFixture } from "./lineage_fixture";

describe("Active Pointer Precedence", () => {
  let db: any;
  let store: SqliteCanonicalServingStore;

  beforeAll(async () => {
    const rawDb = new Database(":memory:");
    db = new SqliteAdapter(rawDb);
    
    // Initialize schema using standard fixture
    await setupLineageTestFixture(db);
    
    store = new SqliteCanonicalServingStore(db);
  });

  it("proves active pointer > legacy timestamp ordering", async () => {
    // 1. Create OLD_CONTEXT (older chronologically, but newer than fixture so it takes precedence over fixture)
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_old", "tenant_A", "person_A", "plan_A", "hashOld", "{}"]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      ["context_old", "tenant_A", "person_A", "sps_old", "v1", "hash_ontology", "v1", "v1", "2030-01-01 10:00:00"]
    );
    
    // 2. Create NEW_CONTEXT (newer chronologically)
    await db.execute(
      `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
      ["sps_new", "tenant_A", "person_A", "plan_A", "hashNew", "{}"]
    );
    await db.execute(
      `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      ["context_new", "tenant_A", "person_A", "sps_new", "v1", "hash_ontology", "v1", "v1", "2030-01-01 12:00:00"]
    );

    // Establish the explicit pointer that defines current serving authority.
    await store.bindEvaluationContextScope("context_new", "tenant_A", "person_A", "plan_A");
    await store.activateContextPointer("context_new", "tenant_A", "person_A", "plan_A");
    const fbContext = await store.getActiveContext({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    expect(fbContext?.contextFingerprint).toBe("context_new");

    // 3. Bind and activate OLD_CONTEXT explicitly
    await store.bindEvaluationContextScope("context_old", "tenant_A", "person_A", "plan_A");
    await store.activateContextPointer("context_old", "tenant_A", "person_A", "plan_A");

    // 4. Assert that OLD_CONTEXT wins
    const activeContext = await store.getActiveContext({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    expect(activeContext?.contextFingerprint).toBe("context_old");

    // 5. Deactivate pointer and verify legacy chronological fallback behaves as intended
    await db.execute(`DELETE FROM active_evaluation_contexts WHERE tenant_id = 'tenant_A' AND person_id = 'person_A' AND search_plan_id = 'plan_A'`);
    
    const fallbackContext = await store.getActiveContext({ tenantId: "tenant_A", personId: "person_A", roles: [] });
    expect(fallbackContext?.contextFingerprint).toBe("context_new");
  });
});
