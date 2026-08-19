import { getDatabaseAdapter } from "../src/data/database/index";

async function run() {
  const db = getDatabaseAdapter();
  const row: any = await db.one("SELECT * FROM career_profiles LIMIT 1");
  if (row) {
    console.log("career_profiles columns:");
    console.log(Object.keys(row));
  } else {
    console.log("career_profiles is empty.");
  }

  const row2: any = await db.one("SELECT * FROM candidate_projection LIMIT 1");
  if (row2) {
    console.log("\ncandidate_projection columns:");
    console.log(Object.keys(row2));
  } else {
    console.log("candidate_projection is empty.");
  }
}

run().catch(console.error);
