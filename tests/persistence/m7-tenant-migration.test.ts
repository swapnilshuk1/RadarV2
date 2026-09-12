import { describe, it, expect, beforeAll } from "vitest";
import { getDatabaseAdapter } from "../../src/data/database";
import { authenticateTenantMembership, authorizePersonScope } from "../../src/lib/security/auth";
import { SqliteEvaluationContextStore } from "../../src/data/sqlite/repositories/SqliteEvaluationContextStore";
import { SqliteMaterializedEvaluationStore } from "../../src/data/sqlite/repositories/SqliteMaterializedEvaluationStore";

describe("Milestone M7: Production Tenant Migration & Lineage Validation", () => {
  const db = getDatabaseAdapter();
  const TENANT_ID = "tenant_default";
  const PERSON_ID = "ms6i7e3y-4x0chy5fy";

  let authContext: any;
  let authorizedScope: any;
  let contextStore: SqliteEvaluationContextStore;
  let evalStore: SqliteMaterializedEvaluationStore;

  beforeAll(async () => {
    contextStore = new SqliteEvaluationContextStore(db);
    evalStore = new SqliteMaterializedEvaluationStore(db);
  });

  it("should authenticate the user as owner in tenant_default", async () => {
    authContext = await authenticateTenantMembership(PERSON_ID, TENANT_ID, db);
    expect(authContext.userId).toBe(PERSON_ID);
    expect(authContext.tenantId).toBe(TENANT_ID);
    expect(authContext.permissions).toContain("manage:search_plan");
  });

  it("should authorize the person scope within the tenant", async () => {
    authorizedScope = await authorizePersonScope(authContext, PERSON_ID, db);
    expect(authorizedScope.personId).toBe(PERSON_ID);
    expect(authorizedScope.tenantId).toBe(TENANT_ID);
  });

  it("should have seeded the canonical search plan", async () => {
    const plan = await contextStore.getSearchPlan(authorizedScope, "sp_canonical_swapnil");
    expect(plan).toBeDefined();
    expect(plan?.title).toBe("Executive Career Search Plan");
    expect(plan?.criteria.targetSeniority).toContain("Director");
  });

  it("should have valid evaluation contexts seeded", async () => {
    const contexts = await db.many<any>(`
      SELECT * FROM evaluation_contexts
      WHERE tenant_id = ? AND person_id = ?
    `, [TENANT_ID, PERSON_ID]);
    
    expect(contexts.length).toBeGreaterThan(0);
    const ctx = contexts[0];
    expect(ctx.ontology_version).toBe("3.0.0");
    expect(ctx.policy_version).toBe("v4.1");
  });

  it("should project canonical opportunities and filter via attention gate", async () => {
    const projectionStats = await db.one<any>(`
      SELECT 
        COUNT(*) as total_projected,
        SUM(CASE WHEN attention_decision = 'CANDIDATE' THEN 1 ELSE 0 END) as candidate_count
      FROM search_plan_candidates
      WHERE tenant_id = ? AND person_id = ?
    `, [TENANT_ID, PERSON_ID]);

    expect(Number(projectionStats.total_projected)).toBeGreaterThan(0);
    expect(Number(projectionStats.candidate_count)).toBeGreaterThan(0);
  });

  it("should successfully backfill materialized evaluations", async () => {
    const materializedCount = await db.one<any>(`
      SELECT COUNT(*) as count 
      FROM materialized_evaluations
      WHERE tenant_id = ? AND person_id = ?
    `, [TENANT_ID, PERSON_ID]);

    expect(Number(materializedCount.count)).toBeGreaterThan(0);
  });

  it("should preserve legacy user decisions", async () => {
    // Actual verified count in Turso Cloud is 427.
    // Using 400 as a stable lower-bound floor to guard against zero-data regression
    // while tolerating minor historic variation from earlier forensics estimates.
    const decisionsCount = await db.one<any>(`
      SELECT COUNT(*) as count 
      FROM decisions
      WHERE person_id = ?
    `, [PERSON_ID]);

    expect(Number(decisionsCount.count)).toBeGreaterThanOrEqual(400);
  });

});
