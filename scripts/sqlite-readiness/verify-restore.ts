import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { verifyRequiredSchema } from "../../src/data/sqlite/migrations/runner";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");

const CHECKED_TABLES = [
  "_migrations", "tenants", "people", "canonical_opportunities", "opportunity_versions",
  "evaluation_requirements", "evaluation_jobs", "materialized_evaluations",
  "materialized_dossier_presentations", "dossier_composition_jobs", "dossier_review_jobs",
  "active_evaluation_contexts",
] as const;

function argument(name: string): string | undefined {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function health(db: import("better-sqlite3").Database) {
  const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  const foreignKeys = db.pragma("foreign_key_check") as unknown[];
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new Error("SQLITE_INTEGRITY_CHECK_FAILED");
  if (foreignKeys.length) throw new Error(`SQLITE_FOREIGN_KEY_CHECK_FAILED:${foreignKeys.length}`);
}

function inventory(db: import("better-sqlite3").Database) {
  const existing = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name));
  const counts = Object.fromEntries(CHECKED_TABLES.map((table) => [
    table,
    existing.has(table) ? Number((db.prepare(`SELECT COUNT(*) AS n FROM \"${table}\"`).get() as { n: number }).n) : null,
  ]));
  const migrations = existing.has("_migrations")
    ? (db.prepare("SELECT migration_name FROM _migrations ORDER BY migration_name").all() as Array<{ migration_name: string }>).map((row) => row.migration_name)
    : [];
  return {
    counts,
    migrationFingerprint: createHash("sha256").update(JSON.stringify(migrations)).digest("hex"),
    migrations,
  };
}

const sourcePath = argument("source");
const restoredPath = argument("restored");
if (!sourcePath || !restoredPath || !path.isAbsolute(sourcePath) || !path.isAbsolute(restoredPath)) {
  throw new Error("Usage: npm run sqlite:verify-restore -- --source=<absolute.sqlite> --restored=<absolute.sqlite>");
}
if (!fs.existsSync(sourcePath) || !fs.existsSync(restoredPath)) throw new Error("Both source and restored SQLite files must exist");

const source = new Database(sourcePath, { readonly: true });
const restored = new Database(restoredPath, { readonly: true });
try {
  health(source);
  health(restored);
  await verifyRequiredSchema(new SqliteAdapter(source));
  await verifyRequiredSchema(new SqliteAdapter(restored));
  const sourceInventory = inventory(source);
  const restoredInventory = inventory(restored);
  const equivalent = JSON.stringify(sourceInventory) === JSON.stringify(restoredInventory);
  console.log(JSON.stringify({ sourcePath, restoredPath, equivalent, source: sourceInventory, restored: restoredInventory }, null, 2));
  if (!equivalent) process.exitCode = 1;
} finally {
  source.close();
  restored.close();
}
