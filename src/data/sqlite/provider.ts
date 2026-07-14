import Database from "better-sqlite3";
import path from "path";
import { SqliteCompanyStore } from "./repositories/SqliteCompanyStore";
import { SqliteOpportunityStore } from "./repositories/SqliteOpportunityStore";
import { SqliteAcquisitionStore } from "./repositories/SqliteAcquisitionStore";
import { SqliteKnowledgeStore } from "./repositories/SqliteKnowledgeStore";
import { SqliteReasoningStore } from "./repositories/SqliteReasoningStore";
import { SqlitePersonStore } from "./repositories/SqlitePersonStore";
import { SqliteDecisionSupportStore } from "./repositories/SqliteDecisionSupportStore";
import { SqliteUserOutcomeStore } from "./repositories/SqliteUserStore";

let _db: Database.Database | null = null;

export function getDatabase(dbPath?: string): Database.Database {
  if (!_db) {
    const resolvedPath = dbPath || path.resolve(process.cwd(), "radar.sqlite");
    _db = new Database(resolvedPath);
    _db.pragma('journal_mode = WAL');
  }
  return _db;
}

import type { StorageProvider } from "../../../domain/repositories";

export function createRepositories(db: Database.Database): StorageProvider {
  return {
    companies: new SqliteCompanyStore(db),
    opportunities: new SqliteOpportunityStore(db),
    acquisition: new SqliteAcquisitionStore(db),
    knowledge: new SqliteKnowledgeStore(db),
    reasoning: new SqliteReasoningStore(db),
    people: new SqlitePersonStore(db),
    decisions: new SqliteDecisionSupportStore(db),
    outcomes: new SqliteUserOutcomeStore(db)
  };
}

let _repos: ReturnType<typeof createRepositories> | null = null;

export function getRepositories() {
  if (!_repos) {
    _repos = createRepositories(getDatabase());
  }
  return _repos;
}
