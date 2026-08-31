/**
 * scripts/benchmarks/debug_scope_resolution.ts
 */
import { getDatabaseAdapter } from "../../src/data/database/index";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";

async function main() {
  const db = getDatabaseAdapter();
  const userId = "ms6i7e3y-4x0chy5fy";
  const tenantId = "tenant_default";

  console.log("Testing resolveServingScope for:", { userId, tenantId });
  const result = await resolveServingScope(userId, tenantId, db);
  console.log("Resolved Serving Scope:", result);

  const pointers = await db.many(`SELECT * FROM active_evaluation_contexts WHERE person_id = ?`, [userId]);
  console.log("Active Evaluation Context Pointers:", pointers);

  const searchPlans = await db.many(`SELECT * FROM search_plans WHERE person_id = ?`, [userId]);
  console.log("Search Plans for Person:", searchPlans);

  const snapshots = await db.many(`SELECT * FROM search_plan_snapshots WHERE person_id = ?`, [userId]);
  console.log("Snapshots for Person:", snapshots);

  const contexts = await db.many(`SELECT * FROM evaluation_contexts WHERE person_id = ?`, [userId]);
  console.log("Evaluation Contexts for Person:", contexts);
}

main().catch(console.error);
