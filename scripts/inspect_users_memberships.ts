import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectUsersMemberships() {
  const db = getDatabaseAdapter();
  console.log("Users:");
  console.log(await db.many("SELECT * FROM users"));
  console.log("Memberships:");
  console.log(await db.many("SELECT * FROM memberships"));
}

inspectUsersMemberships().catch(console.error);
