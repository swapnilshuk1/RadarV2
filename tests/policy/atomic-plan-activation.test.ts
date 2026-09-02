import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { SqliteEvaluationContextStore } from "../../src/data/sqlite/repositories/SqliteEvaluationContextStore";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";

const scope = { tenantId: "tenant_A", personId: "person_A", roles: [] };
const criteria = {
  targetSeniority: ["VP"],
  targetRoles: ["VP Growth"],
  targetLocations: ["Bengaluru"],
};

function activationInput(profileVersion: string) {
  return {
    title: "Executive Career Search Plan",
    criteria,
    ontologyVersion: "1.1.0",
    ontologyFingerprint: "ontology-hash-1.1.0",
    policyVersion: "1.1.0",
    profileVersion,
    activatedBy: "intent-update",
  };
}

describe("Atomic career-intent plan activation", () => {
  let db: SqliteAdapter;
  let store: SqliteEvaluationContextStore;

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
    await db.execute(
      `INSERT INTO users (id, email) VALUES (?, ?)`,
      ["person_A", "person-a@example.test"]
    );
    await db.execute(
      `INSERT INTO memberships (user_id, tenant_id, role, permissions, status)
       VALUES (?, ?, ?, ?, ?)` ,
      ["person_A", "tenant_A", "admin", '["*"]', "active"]
    );
    store = new SqliteEvaluationContextStore(db);
  });

  it("immediately routes the scope to the complete replacement lineage and archives prior plans", async () => {
    const first = await store.replaceActiveSearchPlan(scope, activationInput("profile-v1"));
    const second = await store.replaceActiveSearchPlan(scope, activationInput("profile-v2"));

    const oldFixturePlan = await db.one<{ status: string }>(
      `SELECT status FROM search_plans WHERE id = 'plan_A'`
    );
    const firstPlan = await db.one<{ status: string }>(
      `SELECT status FROM search_plans WHERE id = ?`,
      [first.plan.id]
    );
    const secondPlan = await db.one<{ status: string }>(
      `SELECT status FROM search_plans WHERE id = ?`,
      [second.plan.id]
    );
    const pointerCount = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM active_evaluation_contexts WHERE tenant_id = ? AND person_id = ?`,
      [scope.tenantId, scope.personId]
    );
    const boundScope = await db.one<{ context_fingerprint: string }>(
      `SELECT context_fingerprint FROM evaluation_context_scopes WHERE context_fingerprint = ?`,
      [second.context.contextFingerprint]
    );
    const resolved = await resolveServingScope(scope.personId, scope.tenantId, db);

    expect(first.snapshot.snapshotHash).toBe(second.snapshot.snapshotHash);
    expect(first.snapshot.id).not.toBe(second.snapshot.id);
    expect(oldFixturePlan?.status).toBe("archived");
    expect(firstPlan?.status).toBe("archived");
    expect(secondPlan?.status).toBe("active");
    expect(pointerCount?.count).toBe(1);
    expect(boundScope?.context_fingerprint).toBe(second.context.contextFingerprint);
    expect(resolved.activeContext).toEqual({
      searchPlanId: second.plan.id,
      contextFingerprint: second.context.contextFingerprint,
    });
  });

  it("rolls back the complete replacement when pointer creation is rejected", async () => {
    await db.execute(
      `CREATE TRIGGER reject_intent_pointer
       BEFORE INSERT ON active_evaluation_contexts
       WHEN NEW.activated_by = 'intent-update'
       BEGIN
         SELECT RAISE(ABORT, 'intent pointer rejected');
       END`
    );

    await expect(store.replaceActiveSearchPlan(scope, activationInput("profile-v1")))
      .rejects.toThrow("intent pointer rejected");

    const plans = await db.many<{ id: string; status: string }>(
      `SELECT id, status FROM search_plans WHERE tenant_id = ? AND person_id = ? ORDER BY id`,
      [scope.tenantId, scope.personId]
    );
    const snapshots = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM search_plan_snapshots WHERE tenant_id = ? AND person_id = ?`,
      [scope.tenantId, scope.personId]
    );
    const contexts = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM evaluation_contexts WHERE tenant_id = ? AND person_id = ?`,
      [scope.tenantId, scope.personId]
    );
    const pointers = await db.one<{ count: number }>(
      `SELECT COUNT(*) AS count FROM active_evaluation_contexts WHERE tenant_id = ? AND person_id = ?`,
      [scope.tenantId, scope.personId]
    );

    expect(plans).toEqual([{ id: "plan_A", status: "active" }]);
    expect(snapshots?.count).toBe(1);
    expect(contexts?.count).toBe(1);
    expect(pointers?.count).toBe(0);
  });
});
