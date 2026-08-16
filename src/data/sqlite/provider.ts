import { SqliteCompanyStore } from "./repositories/SqliteCompanyStore";
import { SqliteOpportunityStore } from "./repositories/SqliteOpportunityStore";
import { SqliteAcquisitionStore } from "./repositories/SqliteAcquisitionStore";
import { SqliteKnowledgeStore } from "./repositories/SqliteKnowledgeStore";
import { SqliteReasoningStore } from "./repositories/SqliteReasoningStore";
import { SqliteSourceStore } from "./repositories/SqliteSourceStore";
import { SqlitePersonStore } from "./repositories/SqlitePersonStore";
import { SqliteDecisionSupportStore } from "./repositories/SqliteDecisionSupportStore";
import { SqliteDocumentStore } from "./repositories/SqliteDocumentStore";
import { SqliteEvaluationStore } from "./repositories/SqliteEvaluationStore";
import { getDatabaseAdapter, type DatabaseAdapter } from "../database";
import type { StorageProvider } from "../../domain/repositories";

export function getDatabase(dbPath?: string): DatabaseAdapter {
  return getDatabaseAdapter(dbPath);
}

export function createRepositories(db: DatabaseAdapter): StorageProvider {
  return {
    sources: new SqliteSourceStore(db),
    companies: new SqliteCompanyStore(db),
    opportunities: new SqliteOpportunityStore(db),
    acquisition: new SqliteAcquisitionStore(db),
    knowledge: new SqliteKnowledgeStore(db),
    reasoning: new SqliteReasoningStore(db),
    people: new SqlitePersonStore(db),
    decisions: new SqliteDecisionSupportStore(db),
    documents: new SqliteDocumentStore(db),
    evaluations: new SqliteEvaluationStore(db),
  };
}

let _repos: StorageProvider | null = null;

export function getRepositories(dbPath?: string): StorageProvider {
  if (!_repos) {
    _repos = createRepositories(getDatabaseAdapter(dbPath));
  }
  return _repos;
}

export function closeDatabase() {
  _repos = null;
}
