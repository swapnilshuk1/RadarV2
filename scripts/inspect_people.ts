import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectPeople() {
  const db = getDatabaseAdapter();
  const people = await db.many("SELECT * FROM people");
  console.log("People:", people);
}

inspectPeople().catch(console.error);
