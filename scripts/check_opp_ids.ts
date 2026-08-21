import { getDatabaseAdapter } from "../src/data/database/index.js";

async function checkOppIds() {
  const db = getDatabaseAdapter();

  const opps = await db.many<any>("SELECT id FROM opportunities WHERE id NOT LIKE 'o_%' AND id NOT LIKE '%:%'");
  console.log("Opps not like o_% and not like %:%:", opps.length);
  if (opps.length > 0) {
    console.log("Sample:", opps.slice(0, 10));
  }
}

checkOppIds().catch(console.error);
