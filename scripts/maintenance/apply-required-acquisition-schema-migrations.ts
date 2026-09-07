/**
 * Applies only the three production schema migrations required by the fresh
 * acquisition validation path. This is intentionally separate from the normal
 * migration runner so an operational repair cannot accidentally apply later
 * migrations from a dirty working tree.
 *
 * Default mode is read-only preflight. Pass --apply to make the bounded change.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { getDatabaseAdapter } from "../../src/data/database";
import { splitSqlStatements } from "../../src/data/sqlite/migrations/runner";

const here = dirname(fileURLToPath(import.meta.url));
const migrationDirectory = join(here, "../../src/data/sqlite/migrations");
const apply = process.argv.includes("--apply");

const requiredMigrations = [
  "033_opportunity_version_source_payload.sql",
  "034_acquisition_ingestion_lineage.sql",
  "035_search_plan_candidate_eligibility_audit.sql",
] as const;

type MigrationRow = { migration_name: string };
type ColumnRow = { name: string };
type TableRow = { name: string };

function missing(values: readonly string[], required: readonly string[]) {
  const present = new Set(values);
  return required.filter((value) => !present.has(value));
}

async function main() {
  const db = getDatabaseAdapter();
  const appliedRows = await db.many<MigrationRow>(
    "SELECT migration_name FROM _migrations WHERE migration_name IN (?, ?, ?)",
    [...requiredMigrations],
  );
  const applied = new Set(appliedRows.map((row) => row.migration_name));

  const versionColumns = await db.many<ColumnRow>("PRAGMA table_info(opportunity_versions)");
  const sourcePayloadColumns = [
    "source_payload_key",
    "source_media_type",
    "document_extraction_state",
  ] as const;
  const absentPayloadColumns = missing(versionColumns.map((column) => column.name), sourcePayloadColumns);
  const lineageTable = await db.one<TableRow>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ["acquisition_ingestion_lineage"],
  );
  const candidateColumns = await db.many<ColumnRow>("PRAGMA table_info(search_plan_candidates)");
  const eligibilityColumns = ["eligibility", "eligibility_reason_codes_json", "location_policy", "location_evidence"] as const;
  const absentEligibilityColumns = missing(candidateColumns.map((column) => column.name), eligibilityColumns);

  // A partial application must be reconciled by a human. Never manufacture a
  // ledger entry, nor retry an ALTER TABLE whose exact prior state is unclear.
  if (applied.has(requiredMigrations[0]) !== (absentPayloadColumns.length === 0)) {
    throw new Error(
      `Schema drift for ${requiredMigrations[0]}: migration ledger and opportunity_versions columns disagree.`,
    );
  }
  if (applied.has(requiredMigrations[1]) !== Boolean(lineageTable)) {
    throw new Error(
      `Schema drift for ${requiredMigrations[1]}: migration ledger and acquisition_ingestion_lineage table disagree.`,
    );
  }
  if (applied.has(requiredMigrations[2]) !== (absentEligibilityColumns.length === 0)) {
    throw new Error(
      `Schema drift for ${requiredMigrations[2]}: migration ledger and search_plan_candidates columns disagree.`,
    );
  }

  const pending = requiredMigrations.filter((migration) => !applied.has(migration));
  console.log(JSON.stringify({ mode: apply ? "apply" : "preflight", pending }, null, 2));

  if (!apply || pending.length === 0) {
    return;
  }

  for (const migration of pending) {
    const migrationPath = join(migrationDirectory, migration);
    if (!existsSync(migrationPath)) {
      throw new Error(`Required migration file is missing: ${migration}`);
    }
    const statements = splitSqlStatements(readFileSync(migrationPath, "utf8"));
    await db.transaction(async (tx) => {
      for (const statement of statements) {
        await tx.execute(statement);
      }
      await tx.execute("INSERT INTO _migrations (migration_name) VALUES (?)", [migration]);
    });
    console.log(`Applied ${migration}`);
  }

  const finalColumns = await db.many<ColumnRow>("PRAGMA table_info(opportunity_versions)");
  const finalAbsentPayloadColumns = missing(finalColumns.map((column) => column.name), sourcePayloadColumns);
  const finalLineageTable = await db.one<TableRow>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ["acquisition_ingestion_lineage"],
  );
  const finalApplied = await db.many<MigrationRow>(
    "SELECT migration_name FROM _migrations WHERE migration_name IN (?, ?, ?)",
    [...requiredMigrations],
  );

  const finalCandidateColumns = await db.many<ColumnRow>("PRAGMA table_info(search_plan_candidates)");
  const finalAbsentEligibilityColumns = missing(finalCandidateColumns.map((column) => column.name), eligibilityColumns);
  if (finalAbsentPayloadColumns.length > 0 || !finalLineageTable || finalAbsentEligibilityColumns.length > 0 || finalApplied.length !== requiredMigrations.length) {
    throw new Error("Postflight failed: required acquisition schema is incomplete.");
  }

  console.log(JSON.stringify({
    postflight: "passed",
    sourcePayloadColumns,
    lineageTable: finalLineageTable.name,
    eligibilityColumns,
    applied: finalApplied.map((row) => row.migration_name).sort(),
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
