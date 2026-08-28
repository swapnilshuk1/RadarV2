import { describe, it, expect, beforeAll } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import Database from "better-sqlite3";
import { SqliteCanonicalServingStore } from "../../src/data/sqlite/repositories/SqliteCanonicalServingStore";
import { setupLineageTestFixture } from "./lineage_fixture";

describe("Evaluation Context Pointers Integrity", () => {
  let db: any;
  let store: SqliteCanonicalServingStore;

  beforeAll(async () => {
    const rawDb = new Database(":memory:");
    db = new SqliteAdapter(rawDb);
    
    await setupLineageTestFixture(db);

    store = new SqliteCanonicalServingStore(db);
  });

  it("prevents false bindings missing actual lineage", async () => {
    const success = await store.bindEvaluationContextScope("fake_fingerprint", "tenant_A", "person_A", "plan_A");
    expect(success).toBe(false);

    const count = await db.one<{ count: number }>(`SELECT COUNT(*) as count FROM evaluation_context_scopes WHERE context_fingerprint = 'fake_fingerprint'`);
    expect(count?.count).toBe(0);
  });

  it("allows correct scope bindings", async () => {
    const success = await store.bindEvaluationContextScope("fingerprint_A", "tenant_A", "person_A", "plan_A");
    expect(success).toBe(true);

    const count = await db.one<{ count: number }>(`SELECT COUNT(*) as count FROM evaluation_context_scopes WHERE context_fingerprint = 'fingerprint_A'`);
    expect(count?.count).toBe(1);
  });

  it("prevents cross-scope pointer activation mathematically", async () => {
    // Attempt to activate this fingerprint for Tenant B
    const attemptCrossScope = db.execute(`
      INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by)
      VALUES (?, ?, ?, ?, ?)
    `, ["tenant_B", "person_B", "plan_B", "fingerprint_A", "system"]);

    await expect(attemptCrossScope).rejects.toThrow(/FOREIGN KEY constraint failed/i);
  });

  it("allows correct pointer activation", async () => {
    await db.execute(`
      INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by)
      VALUES (?, ?, ?, ?, ?)
    `, ["tenant_A", "person_A", "plan_A", "fingerprint_A", "system"]);

    const active = await db.one<{ context_fingerprint: string }>(`SELECT context_fingerprint FROM active_evaluation_contexts WHERE tenant_id = 'tenant_A'`);
    expect(active?.context_fingerprint).toBe("fingerprint_A");
  });
});
