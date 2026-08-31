/**
 * scripts/benchmarks/inspect_plans.ts
 */
import { getDatabaseAdapter } from "../../src/data/database/index";

async function main() {
  const db = getDatabaseAdapter();

  const tenants = await db.many(`SELECT id, status FROM tenants`);
  console.log("Tenants in DB:", tenants);

  const people = await db.many(`SELECT id, tenant_id, name, email FROM people`);
  console.log("People in DB:", people);

  const plans = await db.many(`SELECT id, tenant_id, person_id, status, title FROM search_plans`);
  console.log("Search Plans in DB:", plans);

  const snapshots = await db.many(`SELECT id, search_plan_id, tenant_id, person_id FROM search_plan_snapshots`);
  console.log("Search Plan Snapshots in DB:", snapshots);

  const contexts = await db.many(`SELECT context_fingerprint, tenant_id, person_id, search_plan_snapshot_id FROM evaluation_contexts`);
  console.log("Evaluation Contexts in DB:", contexts);
}

main().catch(console.error);
