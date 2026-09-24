import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { verifyRequiredSchema } from "../../src/data/sqlite/migrations/runner";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3") as typeof import("better-sqlite3");
const COUNTED_TABLES = ["_migrations", "tenants", "people", "canonical_opportunities", "opportunity_versions", "evaluation_requirements", "evaluation_jobs", "materialized_evaluations", "materialized_dossier_presentations", "dossier_composition_jobs", "dossier_review_jobs", "active_evaluation_contexts"] as const;
const REQUIRED_QUEUE_TABLES = ["enrichment_jobs", "evaluation_jobs", "dossier_composition_jobs", "dossier_review_jobs"] as const;
const CANONICAL_TABLES = ["canonical_opportunities", "opportunity_versions", "materialized_evaluations", "materialized_dossier_presentations"] as const;
const VOLATILE_COLUMNS = new Set(["created_at", "updated_at", "materialized_at", "activated_at", "completed_at", "locked_at", "lease_until"]);

function argument(name: string): string | undefined { return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3); }
function quote(identifier: string): string { return `\"${identifier.replaceAll('\"', '\"\"')}\"`; }
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function health(db: import("better-sqlite3").Database) {
  const integrity = db.pragma("integrity_check") as Array<{ integrity_check: string }>;
  const foreignKeys = db.pragma("foreign_key_check") as unknown[];
  if (integrity.length !== 1 || integrity[0].integrity_check !== "ok") throw new Error("SQLITE_INTEGRITY_CHECK_FAILED");
  if (foreignKeys.length) throw new Error(`SQLITE_FOREIGN_KEY_CHECK_FAILED:${foreignKeys.length}`);
}
function tables(db: import("better-sqlite3").Database): Set<string> {
  return new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((row) => row.name));
}
function stableRows(db: import("better-sqlite3").Database, table: string, selectedColumns?: string[]) {
  const columns = selectedColumns ?? (db.pragma(`table_info(${quote(table)})`) as Array<{ name: string }>).map((row) => row.name).filter((name) => !VOLATILE_COLUMNS.has(name));
  if (!columns.length) return [];
  const sql = `SELECT ${columns.map(quote).join(",")} FROM ${quote(table)} ORDER BY ${columns.map(quote).join(",")}`;
  return db.prepare(sql).all().map((row: Record<string, unknown>) => Object.fromEntries(columns.map((column) => [column, row[column]])));
}
function statusDistribution(db: import("better-sqlite3").Database, table: string) {
  return db.prepare(`SELECT status, COUNT(*) AS count FROM ${quote(table)} GROUP BY status ORDER BY status`).all().map((row: Record<string, unknown>) => ({ status: String(row.status), count: Number(row.count) }));
}
function inventory(db: import("better-sqlite3").Database) {
  const existing = tables(db);
  for (const table of [...REQUIRED_QUEUE_TABLES, ...CANONICAL_TABLES, "active_evaluation_contexts", "_migrations"]) if (!existing.has(table)) throw new Error(`RESTORE_REQUIRED_TABLE_MISSING:${table}`);
  const counts = Object.fromEntries(COUNTED_TABLES.map((table) => [table, existing.has(table) ? Number((db.prepare(`SELECT COUNT(*) AS n FROM ${quote(table)}`).get() as { n: number }).n) : null]));
  const migrations = db.prepare("SELECT id,migration_name FROM _migrations ORDER BY id").all() as Array<{ id: number; migration_name: string }>;
  const queueStates = Object.fromEntries(REQUIRED_QUEUE_TABLES.map((table) => [table, statusDistribution(db, table)]));
  const activePointers = stableRows(db, "active_evaluation_contexts", ["tenant_id", "person_id", "search_plan_id", "context_fingerprint"]);
  const canonicalFingerprints = Object.fromEntries(CANONICAL_TABLES.map((table) => {
    const rows = stableRows(db, table);
    return [table, { rows: rows.length, fingerprint: hash(rows) }];
  }));
  return { counts, migrationFingerprint: hash(migrations), migrations, queueStates, activeEvaluationContexts: { rows: activePointers.length, fingerprint: hash(activePointers) }, canonicalFingerprints };
}

const sourcePath = argument("source");
const restoredPath = argument("restored");
if (!sourcePath || !restoredPath || !path.isAbsolute(sourcePath) || !path.isAbsolute(restoredPath)) throw new Error("Usage: npm run sqlite:verify-restore -- --source=<absolute.sqlite> --restored=<absolute.sqlite>");
if (!fs.existsSync(sourcePath) || !fs.existsSync(restoredPath)) throw new Error("Both source and restored SQLite files must exist");
const source = new Database(sourcePath, { readonly: true });
const restored = new Database(restoredPath, { readonly: true });
try {
  health(source); health(restored);
  await verifyRequiredSchema(new SqliteAdapter(source)); await verifyRequiredSchema(new SqliteAdapter(restored));
  const sourceInventory = inventory(source); const restoredInventory = inventory(restored);
  const equivalent = JSON.stringify(sourceInventory) === JSON.stringify(restoredInventory);
  console.log(JSON.stringify({ sourcePath, restoredPath, equivalent, source: sourceInventory, restored: restoredInventory }, null, 2));
  if (!equivalent) process.exitCode = 1;
} finally { source.close(); restored.close(); }
