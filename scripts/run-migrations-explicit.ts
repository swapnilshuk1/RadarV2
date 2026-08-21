import { runMigrations } from "../src/data/sqlite/migrations/runner";

async function main() {
  const result = await runMigrations();
  console.log("Migrations applied:", result.applied);
  console.log("Migrations skipped:", result.skipped);
}

main().catch(console.error);
