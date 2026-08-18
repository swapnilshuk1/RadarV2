import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getDatabaseAdapter, type DatabaseAdapter } from "../../database";

export interface MigrationResult {
  applied: string[];
  skipped: string[];
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

    if (char === ";") {
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
  migrationsDir?: string
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

  return { applied, skipped };
}

