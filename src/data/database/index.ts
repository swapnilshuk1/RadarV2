import type { DatabaseAdapter } from "./adapter";
import { SqliteAdapter } from "./sqlite";
import { TursoAdapter } from "./turso";
import { splitSqlStatements } from "../sqlite/migrations/runner";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import { createRequire } from "module";
import { loadUnifiedEnvironment } from "../../lib/env";

export type RadarEnvironment = "dev" | "test" | "staging" | "production";

export function getRadarEnv(): RadarEnvironment {
  const env = process.env.RADAR_ENV?.toLowerCase();
  if (env === "dev" || env === "development") return "dev";
  if (env === "test") return "test";
  if (env === "staging") return "staging";
  if (env === "prod" || env === "production") return "production";

  if (process.env.NODE_ENV === "production" || process.env.VERCEL === "1" || process.env.RENDER === "true") {
    return "production";
  }
  if (process.env.NODE_ENV === "test" || process.env.VITEST === "true") {
    return "test";
  }
  return "dev";
}

function getReq() {
  if (typeof window !== "undefined") return null;
  try {
    return createRequire(import.meta.url);
  } catch {
    return null;
  }
}

let _cachedAdapter: DatabaseAdapter | null = null;
let _hasLoggedStartup = false;
let _hasLoadedDatabaseEnvironment = false;

export interface DatabaseTargetIdentity {
  readonly radarEnv: RadarEnvironment;
  readonly engine: "turso" | "sqlite-candidate" | "test-sqlite" | "unconfigured";
  /** Safe, deterministic identity: never includes an auth token or URL query. */
  readonly fingerprint: string;
  readonly sanitizedTarget: string;
}

function readEnvFile(fileBasename: string): Record<string, string> {
  const values: Record<string, string> = {};
  if (typeof window !== "undefined") return values;
  try {
    const envPath = path.resolve(process.cwd(), fileBasename);
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          let val = trimmed.slice(eqIdx + 1).trim();
          if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
          }
          values[key] = val;
        }
      }
    }
  } catch {}
  return values;
}

/**
 * The sole server-side database environment resolver.  Scripts and serving
 * both reach it through getDatabaseAdapter()/getDatabaseTargetIdentity(), so
 * mode-specific Vite loading cannot silently select a different database.
 */
export function loadDatabaseEnvironment(): void {
  if (_hasLoadedDatabaseEnvironment || typeof window !== "undefined") return;
  loadUnifiedEnvironment();
  _hasLoadedDatabaseEnvironment = true;
}

function sanitizeDatabaseUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ""}${parsed.pathname}`;
  } catch {
    return "invalid-url";
  }
}

function resolveSqliteCandidatePath(radarEnv: RadarEnvironment): string | null {
  if (process.env.RADAR_DATABASE_TARGET?.toLowerCase() !== "sqlite-candidate") return null;
  if (radarEnv === "production") {
    throw new Error(
      "[DatabaseAdapter] SQLITE_CANDIDATE_PRODUCTION_FORBIDDEN: persistent SQLite proof mode cannot run with RADAR_ENV=production.",
    );
  }

  const configuredPath = process.env.RADAR_SQLITE_CANDIDATE_PATH;
  if (!configuredPath || !path.isAbsolute(configuredPath)) {
    throw new Error(
      "[DatabaseAdapter] RADAR_SQLITE_CANDIDATE_PATH must be an explicit absolute path.",
    );
  }

  const candidatePath = path.resolve(configuredPath);
  const candidateRoot = path.resolve(
    process.env.RADAR_SQLITE_CANDIDATE_ROOT || "/var/lib/radar-candidate",
  );
  const relative = path.relative(candidateRoot, candidatePath);
  if (
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !candidatePath.toLowerCase().endsWith(".sqlite")
  ) {
    throw new Error(
      `[DatabaseAdapter] SQLITE_CANDIDATE_PATH_OUTSIDE_ROOT: ${candidatePath} must be a .sqlite file below ${candidateRoot}.`,
    );
  }

  return candidatePath;
}

export function getDatabaseTargetIdentity(dbPath?: string): DatabaseTargetIdentity {
  loadDatabaseEnvironment();
  const radarEnv = getRadarEnv();
  const candidatePath = dbPath === ":memory:" ? null : resolveSqliteCandidatePath(radarEnv);
  if (candidatePath) {
    const digest = createHash("sha256").update(candidatePath).digest("hex").slice(0, 16);
    return {
      radarEnv,
      engine: "sqlite-candidate",
      fingerprint: `sqlite-candidate:${digest}`,
      sanitizedTarget: candidatePath,
    };
  }
  if (radarEnv === "test" && process.env.RADAR_USE_TURSO !== "true" && dbPath !== "turso") {
    return { radarEnv, engine: "test-sqlite", fingerprint: "test-sqlite:memory", sanitizedTarget: ":memory:" };
  }
  const url = process.env.TURSO_CONNECTION_URL || process.env.TURSO_DATABASE_URL;
  if (!url) return { radarEnv, engine: "unconfigured", fingerprint: "unconfigured", sanitizedTarget: "unconfigured" };
  const sanitizedTarget = sanitizeDatabaseUrl(url);
  const digest = createHash("sha256").update(sanitizedTarget).digest("hex").slice(0, 16);
  return { radarEnv, engine: "turso", fingerprint: `turso:${digest}`, sanitizedTarget };
}

function assertExpectedDatabaseTarget(identity: DatabaseTargetIdentity): void {
  const expected = process.env.RADAR_EXPECTED_DB_TARGET_FINGERPRINT;
  if (expected && expected !== identity.fingerprint) {
    throw new Error(
      `[DatabaseAdapter] DATABASE_TARGET_MISMATCH: startup resolved ${identity.fingerprint}, ` +
      `but migration/bootstrap resolved ${expected}. Refusing to serve against a different database.`
    );
  }
}

export function getDatabaseAdapter(dbPath?: string): DatabaseAdapter {
  if (typeof window !== "undefined") {
    throw new Error("[DatabaseAdapter] getDatabaseAdapter must only be called on the server");
  }
  if (_cachedAdapter) {
    return _cachedAdapter;
  }

  const identity = getDatabaseTargetIdentity(dbPath);
  assertExpectedDatabaseTarget(identity);
  const radarEnv = identity.radarEnv;
  const tursoUrl = process.env.TURSO_CONNECTION_URL || process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;

  // 1. Explicit, non-production persistent SQLite candidate. There is no
  // implicit fallback: the operator must opt in and provide a path below the
  // candidate root. Existing data is required unless creation is separately
  // and explicitly enabled for bootstrap.
  if (identity.engine === "sqlite-candidate") {
    let DatabaseConstructor: any = null;
    const req = getReq();
    if (req) {
      try {
        DatabaseConstructor = req("better-sqlite3");
      } catch {}
    }
    if (!DatabaseConstructor) {
      throw new Error("[DatabaseAdapter] better-sqlite3 module unavailable for SQLite candidate database");
    }

    const candidatePath = identity.sanitizedTarget;
    const allowCreate = process.env.RADAR_SQLITE_CANDIDATE_ALLOW_CREATE === "true";
    if (!fs.existsSync(candidatePath)) {
      if (!allowCreate) {
        throw new Error(
          `[DatabaseAdapter] SQLITE_CANDIDATE_MISSING: ${candidatePath}. Restore/copy the non-production candidate first, or explicitly set RADAR_SQLITE_CANDIDATE_ALLOW_CREATE=true for bootstrap only.`,
        );
      }
      fs.mkdirSync(path.dirname(candidatePath), { recursive: true });
    }

    const sqliteDb = new DatabaseConstructor(candidatePath, { timeout: 10_000 });
    const journalMode = String(sqliteDb.pragma("journal_mode = WAL", { simple: true })).toLowerCase();
    sqliteDb.pragma("foreign_keys = ON");
    sqliteDb.pragma("busy_timeout = 10000");
    sqliteDb.pragma("synchronous = FULL");
    const foreignKeys = Number(sqliteDb.pragma("foreign_keys", { simple: true }));
    const busyTimeout = Number(sqliteDb.pragma("busy_timeout", { simple: true }));
    // SQLite returns numeric synchronous levels: FULL is 2.
    const synchronous = Number(sqliteDb.pragma("synchronous", { simple: true }));
    if (journalMode !== "wal" || foreignKeys !== 1 || busyTimeout !== 10_000 || synchronous !== 2) {
      sqliteDb.close();
      throw new Error(
        `[DatabaseAdapter] SQLITE_CANDIDATE_PRAGMA_INVALID: journal_mode=${journalMode}, foreign_keys=${foreignKeys}, busy_timeout=${busyTimeout}, synchronous=${synchronous}.`,
      );
    }

    if (!_hasLoggedStartup) {
      console.log("\n─────────────────────────────");
      console.log("RADAR Database Connection");
      console.log("─────────────────────────────");
      console.log("Engine      : SQLite candidate (persistent WAL)");
      console.log(`Target      : ${identity.sanitizedTarget}`);
      console.log(`Fingerprint : ${identity.fingerprint}`);
      console.log(`RADAR_ENV   : ${radarEnv}`);
      console.log("PRAGMAs     : journal_mode=WAL, foreign_keys=ON, busy_timeout=10000, synchronous=FULL");
      console.log("─────────────────────────────\n");
      _hasLoggedStartup = true;
    }

    _cachedAdapter = new SqliteAdapter(sqliteDb);
    return _cachedAdapter;
  }

  // 2. Explicit Test Environment: Default to in-memory SQLite (:memory:) unless RADAR_USE_TURSO is explicitly true
  if (radarEnv === "test" && process.env.RADAR_USE_TURSO !== "true" && dbPath !== "turso") {
    let DatabaseConstructor: any = null;
    const req = getReq();
    if (req) {
      try {
        DatabaseConstructor = req("better-sqlite3");
      } catch {}
    }

    if (!DatabaseConstructor) {
      throw new Error("[DatabaseAdapter] better-sqlite3 module unavailable for in-memory test database");
    }

    if (dbPath === ":memory:") {
      const freshDb = new DatabaseConstructor(":memory:");
      freshDb.exec("PRAGMA foreign_keys = ON;");
      return new SqliteAdapter(freshDb);
    }

    if (_cachedAdapter) return _cachedAdapter;

    const sqliteDb = new DatabaseConstructor(":memory:");
    sqliteDb.exec("PRAGMA foreign_keys = ON;");
    _cachedAdapter = new SqliteAdapter(sqliteDb);

    // Auto-apply schema migrations to in-memory SQLite instance for test isolation
    const migrationsDir = path.resolve(process.cwd(), "src/data/sqlite/migrations");
    if (fs.existsSync(migrationsDir)) {
      const files = fs.readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql") && !f.endsWith("_rollback.sql"))
        .sort();
      for (const file of files) {
        const sqlContent = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
        const stmts = splitSqlStatements(sqlContent);
        for (const stmt of stmts) {
          try {
            sqliteDb.exec(stmt);
          } catch (error) {
            const sql = stmt.toUpperCase();
            const message = error instanceof Error ? error.message : String(error);
            // Historical migration 005 predates the decisions-table recreation.
            // Keep the same narrowly-scoped replay compatibility as runMigrations;
            // every other migration error is fatal in the test harness.
            if (
              (sql.includes("CREATE INDEX IF NOT EXISTS") || sql.includes("CREATE UNIQUE INDEX IF NOT EXISTS")) &&
              message.includes("no such table")
            ) {
              continue;
            }
            throw new Error(`[DatabaseAdapter] Failed applying test migration ${file}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }
    }

    return _cachedAdapter;
  }

  // 3. Turso Connection (required outside explicitly gated SQLite candidate proof mode)
  if (tursoUrl && tursoToken) {
    if (!_hasLoggedStartup) {
      console.log("\n─────────────────────────────");
      console.log("RADAR Database Connection");
      console.log("─────────────────────────────");
      console.log(`Engine      : Turso Cloud (LibSQL)`);
      console.log(`Target      : ${identity.sanitizedTarget}`);
      console.log(`Fingerprint : ${identity.fingerprint}`);
      console.log(`RADAR_ENV   : ${radarEnv}`);
      console.log("─────────────────────────────\n");
      _hasLoggedStartup = true;
    }
    let adapter: DatabaseAdapter = new TursoAdapter(tursoUrl, tursoToken);
    if (process.env.RADAR_FORENSICS === "1") {
      try {
        const { DiagnosticDatabaseAdapter } = require("./diagnostics");
        adapter = new DiagnosticDatabaseAdapter(adapter);
      } catch {}
    }
    _cachedAdapter = adapter;
    return _cachedAdapter;
  }

  // 4. Strict Fail-Fast: Zero Silent Fallbacks to radar.sqlite or No-Op Adapter
  switch (radarEnv) {
    case "production":
      throw new Error("[DatabaseAdapter] Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in production environment.");
    case "staging":
      throw new Error("[DatabaseAdapter] Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in staging environment.");
    case "dev":
      throw new Error("[DatabaseAdapter] Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in dev environment. Local filesystem SQLite fallback (radar.sqlite) is permanently disabled.");
    case "test":
      throw new Error("[DatabaseAdapter] Missing database configuration for test environment. Must provide Turso credentials or specify ':memory:' for isolated unit tests.");
    default:
      throw new Error(`[DatabaseAdapter] Missing required database configuration for environment: ${radarEnv}`);
  }
}

export function resetDatabaseAdapter() {
  _cachedAdapter = null;
  _hasLoggedStartup = false;
  _hasLoadedDatabaseEnvironment = false;
}

export type { DatabaseAdapter, QueryParams } from "./adapter";
