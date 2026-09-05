import { runMigrations } from "../src/data/sqlite/migrations/runner";
import { getDatabaseTargetIdentity } from "../src/data/database";

async function main() {
  const identity = getDatabaseTargetIdentity();
  console.log(`Database target fingerprint: ${identity.fingerprint}`);
  console.log(`Database target: ${identity.sanitizedTarget}`);
  const result = await runMigrations();
  console.log(`Applied migrations (${result.applied.length}):`, result.applied);
  console.log(`Skipped migrations (${result.skipped.length}):`, result.skipped);
}

main().catch((error) => {
  console.error("Database migration failed; application startup is blocked.", error);
  process.exitCode = 1;
});
