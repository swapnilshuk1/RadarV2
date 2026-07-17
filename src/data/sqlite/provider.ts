import Database from "better-sqlite3";
import path from "path";
import { SqliteCompanyStore } from "./repositories/SqliteCompanyStore";
import { SqliteOpportunityStore } from "./repositories/SqliteOpportunityStore";
import { SqliteAcquisitionStore } from "./repositories/SqliteAcquisitionStore";
import { SqliteKnowledgeStore } from "./repositories/SqliteKnowledgeStore";
import { SqliteReasoningStore } from "./repositories/SqliteReasoningStore";
import { SqliteSourceStore } from "./repositories/SqliteSourceStore";
import { SqlitePersonStore } from "./repositories/SqlitePersonStore";
import { SqliteDecisionSupportStore } from "./repositories/SqliteDecisionSupportStore";

let _db: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (!_db) {
    const resolvedPath = dbPath || process.env.SQLITE_DB_PATH || path.resolve(process.cwd(), "radar.sqlite");
    _db = new Database(resolvedPath);
    _db.pragma('journal_mode = WAL');
  }
  return _db;
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
