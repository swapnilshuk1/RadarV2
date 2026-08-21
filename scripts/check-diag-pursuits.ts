import { getDatabaseAdapter } from "../src/data/database/index";

async function run() {
  const db = getDatabaseAdapter();
  console.log("─────────────────────────────");
  console.log("RADAR Forensics — Active Pursuits and Profile Capacity");
  console.log("─────────────────────────────");

  const userId = "ms6i7e3y-4x0chy5fy";

  // 1. Check career_profiles table
  const cp: any = await db.one(
    "SELECT * FROM career_profiles WHERE person_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  if (cp) {
    console.log("career_profiles Row found:");
    console.log("  id:", cp.id);
    console.log("  person_id:", cp.person_id);
    console.log("  updated_at:", cp.updated_at);
    console.log("  target_altitude:", cp.target_altitude);
    console.log("  headspace_capacity_per_month:", cp.headspace_capacity_per_month);
    console.log("  attention_window:", cp.attention_window);
  } else {
    console.log("No row found in career_profiles.");
  }

  // 2. Check candidate_projection table
  const proj: any = await db.one(
    "SELECT * FROM candidate_projection WHERE person_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  if (proj) {
    console.log("\ncandidate_projection Row found:");
    console.log("  id:", proj.id);
    console.log("  person_id:", proj.person_id);
    console.log("  created_at:", proj.created_at);
    try {
      const parsed = JSON.parse(proj.projection_json || proj.json_payload || "{}");
      console.log("  Parsed projection_json details:");
      console.log("    attentionWindow:", parsed.attentionWindow);
      console.log("    headspaceCapacityPerMonth:", parsed.headspaceCapacityPerMonth);
    } catch (err: any) {
      console.log("  Could not parse JSON:", err.message);
    }
  } else {
    console.log("No row found in candidate_projection.");
  }

  // 3. Count active pursuits in decisions table
  const activePursuits = await db.many(
    "SELECT * FROM decisions WHERE person_id = ? AND action = 'PURSUE'",
    [userId]
  );
  console.log(`\nActive Pursuits in 'decisions' table for user ${userId}:`);
  console.log("  Total Count:", activePursuits.length);
  activePursuits.forEach((ap, idx) => {
    console.log(`    ${idx + 1}. Job Hash: ${ap.opportunity_id}, Action: ${ap.action}, UpdatedAt: ${ap.updated_at}`);
  });

  // 4. Count all decisions to understand overall user state
  const totalDecisions = await db.many(
    "SELECT * FROM decisions WHERE person_id = ?",
    [userId]
  );
  console.log(`\nTotal decisions logged: ${totalDecisions.length}`);
}

run().catch(console.error);
