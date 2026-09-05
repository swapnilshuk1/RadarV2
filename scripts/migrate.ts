import { runMigrations } from "../src/data/sqlite/migrations/runner";

async function main() {
  const result = await runMigrations();
  console.log(`Applied migrations (${result.applied.length}):`, result.applied);
  console.log(`Skipped migrations (${result.skipped.length}):`, result.skipped);
}

main().catch((error) => {
  console.error("Database migration failed; application startup is blocked.", error);
  process.exitCode = 1;
});
