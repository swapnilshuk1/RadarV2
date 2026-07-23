import type Database from "better-sqlite3";

import { SqliteCompanyStore } from "./repositories/SqliteCompanyStore";
import { SqliteOpportunityStore } from "./repositories/SqliteOpportunityStore";
import { SqliteAcquisitionStore } from "./repositories/SqliteAcquisitionStore";
import { SqliteKnowledgeStore } from "./repositories/SqliteKnowledgeStore";
import { SqliteReasoningStore } from "./repositories/SqliteReasoningStore";
import { SqliteSourceStore } from "./repositories/SqliteSourceStore";
import { SqlitePersonStore } from "./repositories/SqlitePersonStore";
import { SqliteDecisionSupportStore } from "./repositories/SqliteDecisionSupportStore";
import { runMigrations } from "./migrations/runner";

let _db: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (typeof window !== "undefined") {
    return {
      prepare: () => ({
        get: () => null,
        all: () => [],
        run: () => ({ changes: 0, lastInsertRowId: 0 }),
      }),
      transaction: (fn: any) => fn,
    } as any;
  }
  if (!_db) {
    try {
      let requireInstance: any = null;
      if (typeof require !== "undefined") {
        requireInstance = require;
      } else {
        try {
          requireInstance = eval("require('module')").createRequire(import.meta.url);
        } catch {}
      }

      if (!requireInstance) {
        return {
          prepare: () => ({
            get: () => null,
            all: () => [],
            run: () => ({ changes: 0, lastInsertRowId: 0 }),
          }),
          transaction: (fn: any) => fn,
        } as any;
      }

      const pathModule = requireInstance("path");
      const DatabaseConstructor = requireInstance("better-sqlite3");
      const fsModule = requireInstance("fs");

      const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.NETLIFY);
      let resolvedPath = dbPath || process.env.SQLITE_DB_PATH;

      if (!resolvedPath) {
        const bundledPath = pathModule.resolve(process.cwd(), "radar.sqlite");
        if (isServerless) {
          const tmpPath = pathModule.resolve("/tmp", "radar.sqlite");
          // On cold start, copy the bundled read-only database to writable /tmp
          if (!fsModule.existsSync(tmpPath) && fsModule.existsSync(bundledPath)) {
            try {
              console.log("[Database] Serverless detected. Copying bundled radar.sqlite to writable /tmp...");
              fsModule.copyFileSync(bundledPath, tmpPath);
            } catch (err: any) {
              console.error("[Database] Failed to copy database to /tmp:", err.message);
            }
          }
          resolvedPath = tmpPath;
        } else {
          resolvedPath = bundledPath;
        }
      }
      
      try {
        runMigrations(resolvedPath);
      } catch (err) {
        console.error("[Database] Migration execution failed:", err);
      }

      _db = new DatabaseConstructor(resolvedPath);
      try {
        _db!.pragma('journal_mode = WAL');
      } catch (walErr: any) {
        console.warn("[Database] Failed to set journal_mode to WAL:", walErr.message);
      }
    } catch (err) {
      console.error("[Database] Initialization error:", err);
    }
  }
  return _db || {
    prepare: () => ({
      get: () => null,
      all: () => [],
      run: () => ({ changes: 0, lastInsertRowId: 0 }),
    }),
    transaction: (fn: any) => fn,
  } as any;
}

export function closeDatabase() {
  if (_db) {
    _db.close();
    _db = null;
    _repos = null;
  }
}

import type { StorageProvider } from "../../domain/repositories";

export function createRepositories(db: Database.Database): StorageProvider {
  return {
    sources: new SqliteSourceStore(db),
    companies: new SqliteCompanyStore(db),
    opportunities: new SqliteOpportunityStore(db),
    acquisition: new SqliteAcquisitionStore(db),
    knowledge: new SqliteKnowledgeStore(db),
    reasoning: new SqliteReasoningStore(db),
    people: new SqlitePersonStore(db),
    decisions: new SqliteDecisionSupportStore(db)
  };
}

let _repos: ReturnType<typeof createRepositories> | null = null;

export function getRepositories(dbPath?: string) {
  if (!_repos) {
    _repos = createRepositories(getDatabase(dbPath));
  }
  return _repos;
}
