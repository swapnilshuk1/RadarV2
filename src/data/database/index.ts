import type { DatabaseAdapter } from "./adapter";
import { SqliteAdapter } from "./sqlite";
import { TursoAdapter } from "./turso";
import path from "path";
import fs from "fs";

import { createRequire } from "module";

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
  loadEnvFile("gemini.env");
  loadEnvFile("groq.env");

  const tursoUrl = process.env.TURSO_CONNECTION_URL || process.env.TURSO_DATABASE_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL === "1" || process.env.RENDER === "true";

  if (isProduction && (!tursoUrl || !tursoToken)) {
    throw new Error("[DatabaseAdapter] Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in production environment.");
  }

  if (tursoUrl && tursoToken) {
    if (!_hasLoggedStartup) {
      console.log("\n─────────────────────────────");
      console.log("RADAR Database Connection");
      console.log("─────────────────────────────");
      console.log(`Engine      : Turso Cloud`);
      console.log(`Target URL  : ${tursoUrl}`);
      console.log(`Environment : ${isProduction ? "Production" : "Development"}`);
      console.log("─────────────────────────────\n");
      _hasLoggedStartup = true;
    }
    _cachedAdapter = new TursoAdapter(tursoUrl, tursoToken);
    return _cachedAdapter;
  }

  // Fallback to SQLite (better-sqlite3) for local offline/unit test environments
  try {
    let DatabaseConstructor: any = null;
    const req = getReq();
    if (req) {
      try {
        DatabaseConstructor = req("better-sqlite3");
      } catch {}
    }

    if (!DatabaseConstructor) {
      throw new Error("better-sqlite3 module unavailable in this environment");
    }

    const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.RENDER);
    let resolvedPath = dbPath || process.env.SQLITE_DB_PATH;
    if (!resolvedPath) {
      const bundledPath = path.resolve(process.cwd(), "radar.sqlite");
      if (isServerless) {
        const tmpPath = path.resolve("/tmp", "radar.sqlite");
        if (!fs.existsSync(tmpPath) && fs.existsSync(bundledPath)) {
          try {
            fs.copyFileSync(bundledPath, tmpPath);
          } catch {}
        }
        resolvedPath = tmpPath;
      } else {
        resolvedPath = bundledPath;
      }
    }

    const sqliteDb = new DatabaseConstructor(resolvedPath);
    try {
      sqliteDb.pragma("journal_mode = WAL");
    } catch {}

    if (!_hasLoggedStartup) {
      console.log("\n─────────────────────────────");
      console.log("RADAR Database Connection");
      console.log("─────────────────────────────");
      console.log(`Engine      : Local SQLite`);
      console.log(`Path        : ${resolvedPath}`);
      console.log("─────────────────────────────\n");
      _hasLoggedStartup = true;
    }

    _cachedAdapter = new SqliteAdapter(sqliteDb);
    return _cachedAdapter;
  } catch (err: any) {
    console.error("⚠️ [Database] Failed to initialize SQLite fallback:", err.message);
    // Return dummy no-op adapter so the app never crashes with unhandled exception
    _cachedAdapter = {
      async one<T>() { return null; },
      async many<T>() { return []; },
      async execute() { return { rowsAffected: 0 }; },
      async transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
        return fn({
          one: async () => null,
          many: async () => [],
          execute: async () => ({ rowsAffected: 0 }),
          transaction: async (f: any) => f(this)
        });
      }
    };
    return _cachedAdapter;
  }
}

export function resetDatabaseAdapter() {
  _cachedAdapter = null;
  _hasLoggedStartup = false;
}

export type { DatabaseAdapter, QueryParams } from "./adapter";
