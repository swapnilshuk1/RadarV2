import { DatabaseAdapter } from "../../src/data/database/adapter";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { expect } from "vitest";

export async function setupLineageTestFixture(db: DatabaseAdapter): Promise<void> {
  // 1. Apply canonical migrations
  await runMigrations(db);

  // 2. Execute PRAGMA foreign_keys = ON;
  await db.execute("PRAGMA foreign_keys = ON;");

  // 3. Assert PRAGMA table_info(people) contains expected canonical columns
  const tableInfo = await db.many<{ name: string; type: string }>(`PRAGMA table_info(people)`);
  const columns = tableInfo.map((c) => c.name);
  
  expect(columns).toContain("id");
  expect(columns).toContain("email");
  expect(columns).toContain("tenant_id");
  expect(columns).not.toContain("auth_id"); // Ensure we didn't ad-hoc patch this

  // 4. Seed valid tenant/person/plan/snapshot/context scope rows
  // Tenants (018)
  await db.execute(`INSERT INTO tenants (id, status) VALUES (?, ?)`, ["tenant_A", "active"]);
  await db.execute(`INSERT INTO tenants (id, status) VALUES (?, ?)`, ["tenant_B", "active"]);
  
  // People (001 + 018)
  await db.execute(`INSERT INTO people (id, email, tenant_id) VALUES (?, ?, ?)`, ["person_A", "a@a.com", "tenant_A"]);
  await db.execute(`INSERT INTO people (id, email, tenant_id) VALUES (?, ?, ?)`, ["person_B", "b@b.com", "tenant_B"]);

  // Search Plans (001 + 018 implies tenant_id)
  await db.execute(
    `INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES (?, ?, ?, ?, ?, ?)`, 
    ["plan_A", "tenant_A", "person_A", "active", "Plan A", "{}"]
  );
  await db.execute(
    `INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES (?, ?, ?, ?, ?, ?)`, 
    ["plan_B", "tenant_B", "person_B", "active", "Plan B", "{}"]
  );

  // Search Plan Snapshots (019)
  await db.execute(
    `INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, ?, ?)`, 
    ["sps_A", "tenant_A", "person_A", "plan_A", "hashA", "{}"]
  );
  
  // Evaluation Contexts (019)
  await db.execute(
    `INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, 
    ["fingerprint_A", "tenant_A", "person_A", "sps_A", "v1", "hash_ontology", "v1", "v1"]
  );
}

/** Creates explicit serving authority for the fixture's A lineage. */
export async function activateLineageTestContext(db: DatabaseAdapter): Promise<void> {
  // Migration 028 requires an immutable scope binding before an active pointer.
  await db.execute(
    `INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id)
     VALUES (?, ?, ?, ?)`,
    ["fingerprint_A", "tenant_A", "person_A", "plan_A"]
  );
  await db.execute(
    `INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by)
     VALUES (?, ?, ?, ?, ?)`,
    ["tenant_A", "person_A", "plan_A", "fingerprint_A", "test-fixture"]
  );
}
