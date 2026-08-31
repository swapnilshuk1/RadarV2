import { describe, test, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "./lineage_fixture";

describe("Evaluation Context Scope Triggers", () => {
  let db: SqliteAdapter;

  beforeAll(async () => {
    const rawDb = new Database(":memory:");
    db = new SqliteAdapter(rawDb);
    await setupLineageTestFixture(db);
    
    // Explicitly enforce PRAGMA foreign_keys = ON to ensure isolation and triggers operate properly
    await db.execute("PRAGMA foreign_keys = ON;");
  });

  test("Insert succeeds when tenant/person/plan matches actual lineage", async () => {
    await expect(
      db.execute(
        `INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id) VALUES (?, ?, ?, ?)`,
        ["fingerprint_A", "tenant_A", "person_A", "plan_A"]
      )
    ).resolves.not.toThrow();
  });

  test("Insert fails when search_plan_id does not match the actual snapshot lineage", async () => {
    await expect(
      db.execute(
        `INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id) VALUES (?, ?, ?, ?)`,
        ["fingerprint_A", "tenant_A", "person_A", "plan_B_forged"]
      )
    ).rejects.toThrow("Context scope lineage mismatch");
  });

  test("Insert fails when tenant_id does not match", async () => {
    await expect(
      db.execute(
        `INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id) VALUES (?, ?, ?, ?)`,
        ["fingerprint_A", "tenant_B_forged", "person_A", "plan_A"]
      )
    ).rejects.toThrow("Context scope lineage mismatch");
  });
});
