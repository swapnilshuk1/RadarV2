import type {
  AcquisitionStore,
  CompanyStore,
  CredentialStore,
  DecisionSupportStore,
  KnowledgeStore,
  OpportunityStore,
  PersonStore,
  ReasoningStore,
  SourceStore,
} from "@/domain/repositories";
import type { SqliteDocumentStore } from "@/data/sqlite/repositories/SqliteDocumentStore";
import type { SqliteEvaluationStore } from "@/data/sqlite/repositories/SqliteEvaluationStore";
import type { SqliteOpportunityQueries } from "@/data/sqlite/repositories/SqliteOpportunityQueries";
import type { SqliteEvaluationContextStore } from "@/data/sqlite/repositories/SqliteEvaluationContextStore";
import type { SqliteScrapeRunStore } from "@/data/sqlite/repositories/SqliteScrapeRunStore";

export interface StorageProvider {
  sources: SourceStore;
  companies: CompanyStore;
  opportunities: OpportunityStore;
  acquisition: AcquisitionStore;
  knowledge: KnowledgeStore;
  reasoning: ReasoningStore;
  people: PersonStore;
  decisions: DecisionSupportStore;
  documents: SqliteDocumentStore;
  evaluations: SqliteEvaluationStore;
  credentials: CredentialStore;
  /** Sole production serving read-model authority. */
  canonicalServing: SqliteOpportunityQueries;
  evaluationContexts: SqliteEvaluationContextStore;
  scrapeRuns: SqliteScrapeRunStore;
}
