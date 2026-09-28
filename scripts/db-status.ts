import {
  closeDatabaseAdapter,
  getDatabaseAdapter,
  getDatabaseTargetIdentity,
} from "../src/data/database";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getRequiredSchemaStatus,
  verifyMigrationChecksums,
  verifyRequiredSchema,
} from "../src/data/sqlite/migrations/runner";

async function main() {
  const identity = getDatabaseTargetIdentity();
  console.log(`RADAR_ENV: ${identity.radarEnv}`);
  console.log(`Database engine: ${identity.engine}`);
  console.log(`Database target: ${identity.sanitizedTarget}`);
  console.log(`Database target fingerprint: ${identity.fingerprint}`);

  const db = getDatabaseAdapter();
  const migrationDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../src/data/sqlite/migrations",
  );
  const migrationHead = fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql") && !name.endsWith("_rollback.sql"))
    .sort()
    .at(-1);
  const migrations = await db.many<{ migration_name: string }>(
    "SELECT migration_name FROM _migrations ORDER BY id ASC",
  );
  const schema = await getRequiredSchemaStatus(db);
  await verifyMigrationChecksums(db);
  await verifyRequiredSchema(db);
  console.log(`Migration head: ${migrationHead ?? "none"}`);
  console.log(`Applied migration head: ${migrations.at(-1)?.migration_name ?? "none"}`);
  console.log("Migration checksum integrity: valid");
  console.log("Required schema: valid");
  console.log(JSON.stringify(schema));
}

main()
  .catch((error) => {
    console.error("Database status failed; application startup must remain blocked.", error);
    process.exitCode = 1;
  })
  .finally(closeDatabaseAdapter);
