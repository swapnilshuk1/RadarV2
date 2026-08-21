import { getDatabaseAdapter } from "../src/data/database/index.js";

async function inspectTenantsAndPeople() {
  const db = getDatabaseAdapter();

  console.log("--- Tenants ---");
  const tenants = await db.many("SELECT * FROM tenants");
  console.table(tenants);

  console.log("--- People ---");
  const people = await db.many("SELECT * FROM people");
  console.table(people);

  console.log("--- Users ---");
  const users = await db.many("SELECT * FROM users");
  console.table(users);

  console.log("--- Memberships ---");
  const memberships = await db.many("SELECT * FROM memberships");
  console.table(memberships);

  console.log("--- Search Plans ---");
  const searchPlans = await db.many("SELECT * FROM search_plans");
  console.table(searchPlans);

  console.log("--- Evaluation Contexts ---");
  const evalContexts = await db.many("SELECT * FROM evaluation_contexts");
  console.table(evalContexts);
}

inspectTenantsAndPeople().catch(console.error);
