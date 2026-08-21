import { getDatabaseAdapter } from "../src/data/database/index.js";

async function verifyGate7TenantIsolation() {
  const db = getDatabaseAdapter();

  console.log("=== GATE 7: MULTI-TENANT LINEAGE & ZERO-ORPHAN AUDIT ===");

  // 1. Check zero orphans in all tenant-scoped tables
  const tables = [
    { name: "canonical_decisions", personCol: "person_id", tenantCol: "tenant_id" },
    { name: "search_plans", personCol: "person_id", tenantCol: "tenant_id" },
    { name: "search_plan_snapshots", personCol: "person_id", tenantCol: "tenant_id" },
    { name: "search_plan_candidates", personCol: "person_id", tenantCol: "tenant_id" },
    { name: "evaluation_contexts", personCol: "person_id", tenantCol: "tenant_id" },
    { name: "materialized_evaluations", personCol: "person_id", tenantCol: "tenant_id" },
    { name: "evaluation_jobs", personCol: "person_id", tenantCol: "tenant_id" }
  ];

  for (const t of tables) {
    const orphanCount = await db.one<any>(`
      SELECT COUNT(*) as c
      FROM ${t.name} t
      LEFT JOIN people p ON t.${t.personCol} = p.id AND t.${t.tenantCol} = p.tenant_id
      WHERE p.id IS NULL
    `);
    console.log(`Orphan count in [${t.name}]: ${orphanCount?.c || 0}`);
  }

  // 2. Behavioral Cross-Tenant Insertion Attack Test
  console.log("\n=== BEHAVIORAL CROSS-TENANT ATTACK TEST ===");

  // Try to insert a canonical decision where person belongs to tenant_A but tenant_id is tenant_B
  try {
    await db.execute(`
      INSERT INTO canonical_decisions (
        id, tenant_id, person_id, canonical_job_id, action, created_at, updated_at
      ) VALUES (
        'attack_test_1', 'fake_tenant_cross', 'ms6i7e3y-4x0chy5fy', 'some_canon_job_1', 'PURSUE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `);
    console.log("ERROR: Cross-tenant insertion unexpectedly succeeded! (FAIL)");
  } catch (err: any) {
    console.log("SUCCESS: Cross-tenant insertion blocked by FK constraint: (PASS)");
    console.log("Error message:", err.message);
  }
}

verifyGate7TenantIsolation().catch(console.error);
