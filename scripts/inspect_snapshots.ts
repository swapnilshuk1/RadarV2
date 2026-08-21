import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectSnapshots() {
  const db = getDatabaseAdapter();

  const snapshots = await db.many<any>("SELECT id, search_plan_id, tenant_id, person_id, payload_json FROM search_plan_snapshots");
  console.log("Snapshots count:", snapshots.length);
  for (const s of snapshots) {
    console.log("Snapshot ID:", s.id, "Plan:", s.search_plan_id, "Payload:", JSON.parse(s.payload_json));
  }
}

inspectSnapshots().catch(console.error);
