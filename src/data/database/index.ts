import type { DatabaseAdapter } from "./adapter";
import { SqliteAdapter } from "./sqlite";
import { TursoAdapter } from "./turso";
import path from "path";
import fs from "fs";

let _cachedAdapter: DatabaseAdapter | null = null;
let _hasLoggedStartup = false;

function loadEnvFile(fileBasename: string) {
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
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

export function getDatabaseAdapter(dbPath?: string): DatabaseAdapter {
  if (_cachedAdapter) {
    return _cachedAdapter;
  }

  loadEnvFile(".env");
  loadEnvFile("gemini.env");
  loadEnvFile("groq.env");

  const tursoUrl = process.env.TURSO_CONNECTION_URL;
  const tursoToken = process.env.TURSO_AUTH_TOKEN;
  const isProduction = process.env.NODE_ENV === "production" || process.env.VERCEL === "1";

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

  if (isProduction) {
    console.error("❌ CRITICAL ERROR: TURSO_CONNECTION_URL is missing in production environment!");
  }

  // Fallback to SQLite (better-sqlite3)
  const DatabaseConstructor = require("better-sqlite3");
  const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
  
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
}

export function resetDatabaseAdapter() {
  _cachedAdapter = null;
  _hasLoggedStartup = false;
}

export type { DatabaseAdapter, QueryParams } from "./adapter";
