import { getDatabaseAdapter } from "../src/data/database/index";

async function run() {
  const db = getDatabaseAdapter();
  console.log("─────────────────────────────");
  console.log("RADAR Forensic Profile Data");
  console.log("─────────────────────────────");

  const userId = "ms6i7e3y-4x0chy5fy";

  const cp: any = await db.one(
    "SELECT id, headspace_capacity_per_month, attention_window FROM career_profiles WHERE person_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  if (cp) {
    console.log("career_profiles Row found:");
    console.log("  headspace_capacity_per_month:", cp.headspace_capacity_per_month);
    console.log("  attention_window:", cp.attention_window);
  } else {
    console.log("No row found in career_profiles.");
  }

  const proj: any = await db.one(
    "SELECT id, created_at, projection_json FROM candidate_projection WHERE person_id = ? ORDER BY created_at DESC LIMIT 1",
    [userId]
  );
  if (proj) {
    console.log("\ncandidate_projection Row found:");
    console.log("  created_at:", proj.created_at);
    try {
      const parsed = JSON.parse(proj.projection_json || "{}");
      console.log("  Parsed projection_json details:");
      console.log("    attentionWindow:", parsed.attentionWindow);
      console.log("    headspaceCapacityPerMonth:", parsed.headspaceCapacityPerMonth);
    } catch (err: any) {
      console.log("  Could not parse JSON:", err.message);
    }
  } else {
    console.log("No row found in candidate_projection.");
  }

  // Count active pursuits
  const cnt: any = await db.one(
    "SELECT COUNT(*) as count FROM decisions WHERE person_id = ? AND action = 'PURSUE'",
    [userId]
  );
  console.log("\nTotal PURSUE action count in decisions table:", cnt.count);
}

run().catch(console.error);
