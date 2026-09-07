import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDatabaseAdapter, type DatabaseAdapter } from "../../database";

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export interface RequiredSchemaStatus {
  readonly evaluationFingerprintColumnPresent: boolean;
  readonly categoryIdsColumnPresent: boolean;
}

const REQUIRED_COLUMNS = [
  { table: "materialized_evaluations", column: "evaluation_fingerprint", statusKey: "evaluationFingerprintColumnPresent" as const, migration: "037_materialized_evaluation_fingerprint.sql" },
  { table: "opportunity_versions", column: "category_ids", statusKey: "categoryIdsColumnPresent" as const, migration: "038_opportunity_version_category_projection.sql" },
] as const;

export async function getRequiredSchemaStatus(db: DatabaseAdapter): Promise<RequiredSchemaStatus> {
  let evaluationFingerprintColumnPresent = false;
  let categoryIdsColumnPresent = false;
  for (const required of REQUIRED_COLUMNS) {
    const columns = await db.many<{ name: string }>(`PRAGMA table_info(${required.table})`);
    const present = columns.some((column) => column.name === required.column);
    if (required.statusKey === "evaluationFingerprintColumnPresent") evaluationFingerprintColumnPresent = present;
    else categoryIdsColumnPresent = present;
  }
  return { evaluationFingerprintColumnPresent, categoryIdsColumnPresent };
}

/** Refuse startup when the migration ledger and physical schema diverge. */
export async function verifyRequiredSchema(db: DatabaseAdapter): Promise<RequiredSchemaStatus> {
  const status = await getRequiredSchemaStatus(db);
  for (const required of REQUIRED_COLUMNS) {
    if (!status[required.statusKey]) {
      const recorded = await db.one<{ migration_name: string }>(
        "SELECT migration_name FROM _migrations WHERE migration_name = ?",
        [required.migration],
      );
      const drift = recorded
        ? `SCHEMA_DRIFT: migration ${required.migration} is recorded but ${required.table}.${required.column} is missing.`
        : `SCHEMA_INCOMPATIBLE: required column ${required.table}.${required.column} is missing after migrations.`;
      throw new Error(`[MigrationRunner] ${drift}`);
    }
  }
  return status;
}

/**
 * Splits a SQL script into individual executable statements,
 * ignoring semicolons inside string literals and stripping comments.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inString: "'" | '"' | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let beginDepth = 0;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && nextChar === "/") {
        inBlockComment = false;
        i++; // skip /
      }
      continue;
    }

    if (inString) {
      current += char;
      if (char === inString) {
        if (nextChar === inString) {
          current += nextChar;
          i++;
        } else {
          inString = null;
        }
      }
      continue;
    }

    if (char === "-" && nextChar === "-") {
      inLineComment = true;
      i++;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inBlockComment = true;
      i++;
      continue;
    }

    if (char === "'" || char === '"') {
      inString = char;
      current += char;
      continue;
    }

    // A robust BEGIN ... END depth tracker
    if (!/[a-zA-Z0-9_]/.test(char)) {
      const match = /(?:^|[^a-zA-Z0-9_])([a-zA-Z0-9_]+)$/.exec(current);
      if (match) {
        const word = match[1].toUpperCase();
        if (word === "BEGIN") {
          beginDepth++;
        } else if (word === "END") {
          beginDepth = Math.max(0, beginDepth - 1);
        }
      }
    }

    if (char === ";" && beginDepth === 0) {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    statements.push(trimmed);
  }

  return statements;
}

/**
 * Executes pending database migrations using the canonical DatabaseAdapter.
 * Works uniformly across in-memory SQLite and Turso/libSQL cloud databases.
 */
export async function runMigrations(
  adapter?: DatabaseAdapter,
  migrationsDir?: string,
  options: { verifyRequiredSchema?: boolean } = {},
): Promise<MigrationResult> {
  const db = adapter || getDatabaseAdapter();

  // 1. Ensure the schema migrations table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Fetch all currently applied migrations
  const appliedRows = await db.many<{ migration_name: string }>(
    "SELECT migration_name FROM _migrations ORDER BY id ASC"
  );
  const appliedSet = new Set(appliedRows.map((r) => r.migration_name));

  // 3. Discover migration SQL files
  const dir = migrationsDir || path.dirname(fileURLToPath(import.meta.url));
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && !f.endsWith("_rollback.sql"))
    .sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    if (appliedSet.has(file)) {
      skipped.push(file);
      continue;
    }

    const filePath = path.join(dir, file);
    const sqlContent = fs.readFileSync(filePath, "utf-8");
    const statements = splitSqlStatements(sqlContent);

    // Apply statements within a transaction
    await db.transaction(async (tx) => {
      for (const stmt of statements) {
        try {
          await tx.execute(stmt);
        } catch (err: any) {
          // Historical migration compatibility: If creating an index with IF NOT EXISTS fails because a legacy table
          // was dropped in an earlier historical migration (and recreated later), allow clean replay without mutating historical SQL files.
          const upper = stmt.toUpperCase();
          if (
            (upper.includes("CREATE INDEX IF NOT EXISTS") || upper.includes("CREATE UNIQUE INDEX IF NOT EXISTS")) &&
            err?.message?.includes("no such table")
          ) {
            continue;
          }
          throw err;
        }
      }
      await tx.execute("INSERT INTO _migrations (migration_name) VALUES (?)", [file]);
    });

    applied.push(file);
  }

  if (options.verifyRequiredSchema !== false) {
    await verifyRequiredSchema(db);
  }
  return { applied, skipped };
}

