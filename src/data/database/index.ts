import type { DatabaseAdapter } from "./adapter";
import { SqliteAdapter } from "./sqlite";
import { TursoAdapter } from "./turso";
import path from "path";
import fs from "fs";
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

function loadEnvFile(fileBasename: string) {
  if (typeof window !== "undefined") return;
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
          if (process.env[key] === undefined) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch {}
}

export function getDatabaseAdapter(dbPath?: string): DatabaseAdapter {
  if (typeof window !== "undefined") {
    throw new Error("[DatabaseAdapter] getDatabaseAdapter must only be called on the server");
  }
  if (_cachedAdapter) {
    return _cachedAdapter;
  }

  loadEnvFile(".env");
  loadEnvFile(".env.local");
  loadEnvFile("gemini.env");
  loadEnvFile("groq.env");

  const radarEnv = getRadarEnv();
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
      freshDb.exec("PRAGMA foreign_keys = OFF;");
      return new SqliteAdapter(freshDb);
    }

    if (_cachedAdapter) return _cachedAdapter;

    const sqliteDb = new DatabaseConstructor(":memory:");
    sqliteDb.exec("PRAGMA foreign_keys = OFF;");
    _cachedAdapter = new SqliteAdapter(sqliteDb);

    // Auto-apply schema migrations to in-memory SQLite instance for test isolation
    const migrationsDir = path.resolve(process.cwd(), "src/data/sqlite/migrations");
    if (fs.existsSync(migrationsDir)) {
      try {
        const req = getReq();
        if (req) {
          const { splitSqlStatements } = req("../sqlite/migrations/runner");
          const files = fs.readdirSync(migrationsDir)
            .filter((f) => f.endsWith(".sql") && !f.endsWith("_rollback.sql"))
            .sort();
          for (const file of files) {
            const sqlContent = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
            const stmts = splitSqlStatements(sqlContent);
            for (const stmt of stmts) {
              try {
                sqliteDb.exec(stmt);
              } catch {}
            }
          }
        }
      } catch (err) {
        const files = fs.readdirSync(migrationsDir)
          .filter((f) => f.endsWith(".sql") && !f.endsWith("_rollback.sql"))
          .sort();
        for (const file of files) {
          try {
            const sqlContent = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
            sqliteDb.exec(sqlContent);
          } catch {}
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
      console.log(`Target URL  : ${tursoUrl}`);
      console.log(`RADAR_ENV   : ${radarEnv}`);
      console.log("─────────────────────────────\n");
      _hasLoggedStartup = true;
    }
    _cachedAdapter = new TursoAdapter(tursoUrl, tursoToken);
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
}

export type { DatabaseAdapter, QueryParams } from "./adapter";
