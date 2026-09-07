import { getDatabaseAdapter, getDatabaseTargetIdentity } from "../src/data/database";
import { getRequiredSchemaStatus } from "../src/data/sqlite/migrations/runner";

async function main() {
  const identity = getDatabaseTargetIdentity();
  console.log(`RADAR_ENV: ${identity.radarEnv}`);
  console.log(`Database engine: ${identity.engine}`);
  console.log(`Database target: ${identity.sanitizedTarget}`);
  console.log(`Database target fingerprint: ${identity.fingerprint}`);

  const db = getDatabaseAdapter();
  const migrations = await db.many<{ migration_name: string }>(
    "SELECT migration_name FROM _migrations WHERE migration_name IN (?, ?) ORDER BY migration_name",
    ["037_materialized_evaluation_fingerprint.sql", "038_opportunity_version_category_projection.sql"],
  );
  const recorded = new Set(migrations.map((row) => row.migration_name));
  const schema = await getRequiredSchemaStatus(db);
  console.log(`migration037Recorded: ${recorded.has("037_materialized_evaluation_fingerprint.sql")}`);
  console.log(`evaluationFingerprintColumnPresent: ${schema.evaluationFingerprintColumnPresent}`);
  console.log(`migration038Recorded: ${recorded.has("038_opportunity_version_category_projection.sql")}`);
  console.log(`categoryIdsColumnPresent: ${schema.categoryIdsColumnPresent}`);
}

main().catch((error) => {
  console.error("Database status failed; application startup must remain blocked.", error);
  process.exitCode = 1;
});
