import type { DatabaseAdapter } from "./adapter";
import { SqliteAdapter } from "./sqlite";
import { TursoAdapter } from "./turso";
import { splitSqlStatements } from "../sqlite/migrations/runner";
import path from "path";
import fs from "fs";
import { createHash } from "crypto";
import { createRequire } from "module";

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
  readonly engine: "turso" | "test-sqlite" | "unconfigured";
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
  const radarEnv = getRadarEnv();
  // Shell configuration always wins. File precedence then mirrors Vite's
  // server-mode precedence, but is resolved here once for every server entry
  // point rather than independently by scripts and Vite.
  const fileValues: Record<string, string> = {};
  for (const file of ["gemini.env", "groq.env", ".env", ".env.local"]) {
    Object.assign(fileValues, readEnvFile(file));
  }
  if (radarEnv === "dev") {
    Object.assign(fileValues, readEnvFile(".env.development"), readEnvFile(".env.development.local"));
  }
  for (const key of ["TURSO_CONNECTION_URL", "TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"]) {
    if (process.env[key] === undefined && fileValues[key] !== undefined) {
      process.env[key] = fileValues[key];
    }
  }
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

export function getDatabaseTargetIdentity(dbPath?: string): DatabaseTargetIdentity {
  loadDatabaseEnvironment();
  const radarEnv = getRadarEnv();
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

  // 1. Explicit Test Environment: Default to in-memory SQLite (:memory:) unless RADAR_USE_TURSO is explicitly true
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

  // 2. Turso Connection (Required for Dev, Staging, Production)
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
        const { DiagnosticDatabaseAdapter } = require("../../../scripts/forensics/forensic-adapter");
        adapter = new DiagnosticDatabaseAdapter(adapter);
      } catch {}
    }
    _cachedAdapter = adapter;
    return _cachedAdapter;
  }

  // 3. Strict Fail-Fast: Zero Silent Fallbacks to radar.sqlite or No-Op Adapter
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
