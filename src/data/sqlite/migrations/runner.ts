import fs from "fs";
import path from "path";
import crypto from "crypto";
import { getDatabaseAdapter, type DatabaseAdapter } from "../../database";

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

export interface RequiredSchemaStatus {
  readonly evaluationFingerprintColumnPresent: boolean;
  readonly categoryIdsColumnPresent: boolean;
  readonly candidateDecisionPreferencesColumnPresent: boolean;
  readonly dossierPresentationsTablePresent: boolean;
  readonly tenantScopeTablesPresent: boolean;
  readonly candidateTruthTablesPresent: boolean;
  readonly evaluationControlTablePresent: boolean;
  readonly durableWorkerTablesPresent: boolean;
  readonly operationalLeaseSchemaPresent: boolean;
  readonly acquisitionExecutionSchemaPresent: boolean;
}

export const migrationChecksum = (content: string) =>
  crypto.createHash("sha256").update(content.replace(/\r\n/g, "\n"), "utf8").digest("hex");

const REQUIRED_COLUMNS = [
  {
    table: "materialized_evaluations",
    column: "evaluation_fingerprint",
    statusKey: "evaluationFingerprintColumnPresent" as const,
    migration: "037_materialized_evaluation_fingerprint.sql",
  },
  {
    table: "opportunity_versions",
    column: "category_ids",
    statusKey: "categoryIdsColumnPresent" as const,
    migration: "038_opportunity_version_category_projection.sql",
  },
  {
    table: "career_intents",
    column: "decision_preferences_json",
    statusKey: "candidateDecisionPreferencesColumnPresent" as const,
    migration: "064_candidate_decision_preferences.sql",
  },
] as const;

const REQUIRED_TABLES = [
  "users",
  "tenants",
  "memberships",
  "people",
  "candidate_documents",
  "candidate_document_jobs",
  "document_contents",
  "evidence_graphs",
  "career_intents",
  "profile_projection_source_bindings",
  "evaluation_contexts",
  "evaluation_runtime_control",
  "materialized_dossier_presentations",
  "dossier_review_jobs",
  "scrape_runs",
  "corpus_regeneration_jobs",
  "worker_heartbeats",
  "acquisition_execution_lease",
] as const;

const REQUIRED_SCOPE_COLUMNS = [
  ["people", "tenant_id"],
  ["candidate_documents", "tenant_id"],
  ["candidate_documents", "person_id"],
  ["candidate_document_jobs", "tenant_id"],
  ["candidate_document_jobs", "person_id"],
  ["document_contents", "tenant_id"],
  ["document_contents", "person_id"],
  ["evidence_graphs", "tenant_id"],
  ["evidence_graphs", "person_id"],
  ["career_intents", "tenant_id"],
  ["career_intents", "person_id"],
  ["profile_projection_source_bindings", "tenant_id"],
  ["profile_projection_source_bindings", "person_id"],
] as const;

async function hasTable(db: DatabaseAdapter, table: string): Promise<boolean> {
  return Boolean(
    await db.one<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [table],
    ),
  );
}

async function hasColumn(db: DatabaseAdapter, table: string, column: string): Promise<boolean> {
  const columns = await db.many<{ name: string }>(`PRAGMA table_info(${table})`);
  return columns.some((candidate) => candidate.name === column);
}

export async function getRequiredSchemaStatus(db: DatabaseAdapter): Promise<RequiredSchemaStatus> {
  let evaluationFingerprintColumnPresent = false;
  let categoryIdsColumnPresent = false;
  let candidateDecisionPreferencesColumnPresent = false;
  for (const required of REQUIRED_COLUMNS) {
    const present = await hasColumn(db, required.table, required.column);
    if (required.statusKey === "evaluationFingerprintColumnPresent") {
      evaluationFingerprintColumnPresent = present;
    } else if (required.statusKey === "categoryIdsColumnPresent") {
      categoryIdsColumnPresent = present;
    } else {
      candidateDecisionPreferencesColumnPresent = present;
    }
  }
  const tables = await Promise.all(
    REQUIRED_TABLES.map(async (table) => [table, await hasTable(db, table)] as const),
  );
  const presentTables = new Map(tables);
  const tablePresent = (table: string) =>
    presentTables.get(table as (typeof REQUIRED_TABLES)[number]) === true;
  const scopeColumnsPresent = await Promise.all(
    REQUIRED_SCOPE_COLUMNS.map(([table, column]) => hasColumn(db, table, column)),
  );
  const dossierPresentationsTablePresent = tablePresent("materialized_dossier_presentations");
  const scrapeLeaseColumnsPresent = (
    await Promise.all([
      hasColumn(db, "scrape_runs", "lease_owner"),
      hasColumn(db, "scrape_runs", "lease_token"),
      hasColumn(db, "scrape_runs", "lease_expires_at"),
    ])
  ).every(Boolean);
  return {
    evaluationFingerprintColumnPresent,
    categoryIdsColumnPresent,
    candidateDecisionPreferencesColumnPresent,
    dossierPresentationsTablePresent,
    tenantScopeTablesPresent:
      ["users", "tenants", "memberships", "people"].every(tablePresent) &&
      scopeColumnsPresent.slice(0, 1).every(Boolean),
    candidateTruthTablesPresent:
      [
        "candidate_documents",
        "candidate_document_jobs",
        "document_contents",
        "evidence_graphs",
        "career_intents",
        "profile_projection_source_bindings",
      ].every(tablePresent) && scopeColumnsPresent.slice(1).every(Boolean),
    evaluationControlTablePresent:
      tablePresent("evaluation_contexts") && tablePresent("evaluation_runtime_control"),
    durableWorkerTablesPresent: [
      "scrape_runs",
      "dossier_review_jobs",
      "corpus_regeneration_jobs",
      "worker_heartbeats",
    ].every(tablePresent),
    operationalLeaseSchemaPresent: scrapeLeaseColumnsPresent && tablePresent("worker_heartbeats"),
    acquisitionExecutionSchemaPresent:
      tablePresent("acquisition_execution_lease") &&
      (await hasColumn(db, "acquisition_ingress_submissions", "staging_retired_at")),
  };
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
  if (!status.dossierPresentationsTablePresent) {
    const recorded = await db.one<{ migration_name: string }>(
      "SELECT migration_name FROM _migrations WHERE migration_name = ?",
      ["044_materialized_dossier_presentations.sql"],
    );
    const drift = recorded
      ? "SCHEMA_DRIFT: migration 044_materialized_dossier_presentations.sql is recorded but materialized_dossier_presentations table is missing."
      : "SCHEMA_INCOMPATIBLE: required table materialized_dossier_presentations is missing after migrations.";
    throw new Error(`[MigrationRunner] ${drift}`);
  }
  const currentRequirements: Array<[keyof RequiredSchemaStatus, string]> = [
    [
      "acquisitionExecutionSchemaPresent",
      "acquisition execution/retirement schema (migration 071)",
    ],
    ["tenantScopeTablesPresent", "tenant scope tables/columns"],
    ["candidateTruthTablesPresent", "candidate truth tables/columns"],
    ["evaluationControlTablePresent", "evaluation context/control tables"],
    ["durableWorkerTablesPresent", "durable worker tables"],
    ["operationalLeaseSchemaPresent", "operational worker lease schema"],
  ];
  for (const [key, description] of currentRequirements) {
    if (!status[key]) {
      throw new Error(
        `[MigrationRunner] SCHEMA_INCOMPATIBLE: required ${description} are missing after migrations.`,
      );
    }
  }
  return status;
}

/** Check ledger content against the migration files without applying or rewriting anything. */
export async function verifyMigrationChecksums(
  db: DatabaseAdapter,
  migrationsDir?: string,
): Promise<void> {
  const columns = await db.many<{ name: string }>("PRAGMA table_info(_migrations)");
  if (!columns.some((column) => column.name === "checksum")) {
    throw new Error(
      "[MigrationRunner] MIGRATION_CHECKSUM_UNAVAILABLE: migration ledger has no checksum column.",
    );
  }
  const dir = migrationsDir || path.resolve(process.cwd(), "src/data/sqlite/migrations");
  const files = new Set(
    fs.readdirSync(dir).filter((file) => file.endsWith(".sql") && !file.endsWith("_rollback.sql")),
  );
  const recorded = await db.many<{ migration_name: string; checksum: string | null }>(
    "SELECT migration_name, checksum FROM _migrations ORDER BY id ASC",
  );
  for (const row of recorded) {
    if (!files.has(row.migration_name)) {
      throw new Error(`[MigrationRunner] MIGRATION_CHECKSUM_MISSING_FILE: ${row.migration_name}`);
    }
    const checksum = migrationChecksum(
      fs.readFileSync(path.join(dir, row.migration_name), "utf-8"),
    );
    if (!row.checksum || row.checksum !== checksum) {
      throw new Error(`[MigrationRunner] MIGRATION_CHECKSUM_MISMATCH: ${row.migration_name}`);
    }
  }
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
  options: { verifyRequiredSchema?: boolean; verifyChecksums?: boolean } = {},
): Promise<MigrationResult> {
  const db = adapter || getDatabaseAdapter();

  // 1. Ensure the schema migrations table exists
  await db.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      migration_name TEXT NOT NULL UNIQUE,
      checksum TEXT,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // 2. Fetch all currently applied migrations
  try {
    await db.execute("ALTER TABLE _migrations ADD COLUMN checksum TEXT");
  } catch (error: any) {
    if (!/duplicate column/i.test(error?.message || "")) throw error;
  }
  const appliedRows = await db.many<{ migration_name: string; checksum: string | null }>(
    "SELECT migration_name, checksum FROM _migrations ORDER BY id ASC",
  );
  const appliedSet = new Set(appliedRows.map((r) => r.migration_name));

  // 3. Discover migration SQL files
  const dir = migrationsDir || path.resolve(process.cwd(), "src/data/sqlite/migrations");
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".sql") && !f.endsWith("_rollback.sql"))
    .sort();

  const REBUILD_MIGRATIONS = new Set([
    "042_scrape_runs_distributed_lifecycle.sql",
    "043_distributed_work_identity.sql",
    "046_scrape_runs_nullable_search_plan.sql",
  ]);

  const applied: string[] = [];
  const skipped: string[] = [];

  for (const file of files) {
    const sqlContent = fs.readFileSync(path.join(dir, file), "utf-8");
    const checksum = migrationChecksum(sqlContent);
    if (appliedSet.has(file)) {
      const recorded = appliedRows.find((row) => row.migration_name === file);
      if (!recorded?.checksum) {
        await db.execute(
          "UPDATE _migrations SET checksum=? WHERE migration_name=? AND checksum IS NULL",
          [checksum, file],
        );
      } else if (recorded.checksum !== checksum) {
        throw new Error(`[MigrationRunner] MIGRATION_CHECKSUM_MISMATCH: ${file}`);
      }
      skipped.push(file);
      continue;
    }

    const statements = splitSqlStatements(sqlContent);
    const isRebuild = REBUILD_MIGRATIONS.has(file);

    if (isRebuild && db.executeMigration) {
      const allStatements = [
        ...statements,
        `INSERT INTO _migrations (migration_name,checksum) VALUES ('${file.replace(/'/g, "''")}','${checksum}');`,
      ];
      await db.executeMigration(allStatements, { disableForeignKeys: true });
    } else {
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
              (upper.includes("CREATE INDEX IF NOT EXISTS") ||
                upper.includes("CREATE UNIQUE INDEX IF NOT EXISTS")) &&
              err?.message?.includes("no such table")
            ) {
              continue;
            }
            throw err;
          }
        }
        await tx.execute("INSERT INTO _migrations (migration_name,checksum) VALUES (?,?)", [
          file,
          checksum,
        ]);
      });
    }

    applied.push(file);
  }

  if (options.verifyRequiredSchema !== false) {
    await verifyRequiredSchema(db);
  }
  // Test fixtures may intentionally replay a historical subset from a temporary
  // directory. The canonical runner (no directory override) always verifies.
  if (options.verifyChecksums !== false && !migrationsDir) {
    await verifyMigrationChecksums(db);
  }
  return { applied, skipped };
}
