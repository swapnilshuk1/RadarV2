import { getDatabaseAdapter } from "../src/data/database/index";

async function run() {
  const db = getDatabaseAdapter();
  const row: any = await db.one("SELECT projection_json FROM career_profiles ORDER BY created_at DESC LIMIT 1");
  if (row && row.projection_json) {
    try {
      const parsed = JSON.parse(row.projection_json);
      console.log("Parsed keys inside projection_json:", Object.keys(parsed));
      console.log("Parsed projection_json contents:");
      console.log(JSON.stringify(parsed, null, 2));
    } catch (e: any) {
      console.log("Could not parse JSON:", e.message);
      console.log("Raw projection_json substring (first 200 chars):", row.projection_json.slice(0, 200));
    }
  } else {
    console.log("No projection_json found.");
  }
}

run().catch(console.error);
