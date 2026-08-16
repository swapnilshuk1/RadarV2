import type {
  Source,
  Company,
  Opportunity,
  Document,
  Evidence,
  Fact,
  Claim,
  Person,
  CandidateProfile,
  ResumeVersion,
  RecommendationRun,
  OpportunityAssessment,
  RecommendationRecord
} from "./entities";
import type { CandidateProjection } from "../lib/domain/candidate_projection";
import type { CandidateDocumentRecord, SqliteDocumentStore } from "../data/sqlite/repositories/SqliteDocumentStore";
import type { OpportunitySource } from "../data/opportunity-fixtures";

/**
 * Repository Contracts
 * Defined as pure interfaces returning Promises.
 */

// ============================================================================
// 1. GLOBAL LAYER STORES
// ============================================================================

export interface SourceStore {
  recordSource(source: Source): Promise<void>;
  getSource(id: string): Promise<Source | undefined>;
}

export interface CompanyStore {
  registerCompany(company: Company): Promise<void>;
  findByName(name: string): Promise<Company | undefined>;
}

export interface OpportunityStore {
  mergeOpportunity(opportunity: Opportunity): Promise<void>;
  getOpportunity(id: string): Promise<Opportunity | undefined>;
  listActiveOpportunities(): Promise<Opportunity[]>;
  getQueueOpportunities?(personId: string, limit?: number): Promise<Opportunity[]>;
  
  findOpportunities(criteria: {
    companyId?: string;
    lifecycle?: string;
  }): Promise<Opportunity[]>;

  listOpportunitySources(): Promise<OpportunitySource[]>;
  getOpportunitySource(jobHash: string): Promise<OpportunitySource | undefined>;
}

export interface AcquisitionLedgerItem {
  id: string;
  canonicalJobId: string;
  sourcePortal: string;
  sourceJobId: string;
  canonicalUrl: string;
  title: string;
  companyName: string;
  location?: string;
  state: "DISCOVERED" | "QUEUED" | "CLAIMED" | "ACQUIRING" | "VALIDATED" | "ENRICHED" | "EVALUATED";
  terminalState?: "DUPLICATE" | "CHALLENGE" | "PERMANENT_FAILURE" | "EXPIRED" | "DISCARDED";
  claimedBy?: string;
  claimedAt?: string;
  leaseExpiresAt?: string;
  attemptCount?: number;
  lastFailureClass?: string;
  lastAcquisitionMethod?: string;
  acquisitionQuality?: string;
  validationConfidence?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  lastAcquiredAt?: string;
  freshnessState?: "NEW" | "FRESH" | "AGING" | "STALE" | "EXPIRED";
  createdAt: string;
  updatedAt: string;
}

export interface AcquisitionStore {
  recordDocument(document: Document): Promise<void>;
  logDiscovery(discovery: {
    id: string;
    opportunityId: string;
    executionId: string;
    sourceName: string;
    firstPortal: string;
    firstDefinition: string;
  }): Promise<void>;

  upsertDiscoveredJob(item: Omit<AcquisitionLedgerItem, "id" | "createdAt" | "updatedAt"> & { id?: string }): Promise<AcquisitionLedgerItem>;
  getLedgerItemByCanonicalId(sourcePortal: string, canonicalJobId: string): Promise<AcquisitionLedgerItem | undefined>;
  claimQueuedJobs(workerId: string, limit?: number, leaseMs?: number): Promise<AcquisitionLedgerItem[]>;
  updateJobState(id: string, updates: Partial<AcquisitionLedgerItem>): Promise<void>;
  reclaimExpiredLeases(): Promise<number>;
}

export interface KnowledgeStore {
  recordEvidence(evidence: Evidence[]): Promise<void>;
  recordFacts(facts: Fact[]): Promise<void>;
  
  findEvidenceForDocument(documentId: string): Promise<Evidence[]>;
  findFactsForOpportunity(opportunityId: string): Promise<Fact[]>;
}

export interface ReasoningStore {
  recordClaims(claims: Claim[]): Promise<void>;
  findClaimsForOpportunity(opportunityId: string): Promise<Claim[]>;
}

// ============================================================================
// 2. USER-SCOPED LAYER STORES
// ============================================================================

export interface PersonStore {
  registerPerson(person: Person): Promise<void>;
  getPersonByEmail(email: string): Promise<Person | undefined>;
  
  saveProjection(personId: string, projection: CandidateProjection): Promise<void>;
  saveResumeVersion(version: ResumeVersion): Promise<void>;
  
  getLatestProjection(personId: string): Promise<CandidateProjection | undefined>;
  getResumeVersions(candidateProfileId: string): Promise<ResumeVersion[]>;

  getCandidateState(personId: string): Promise<any | undefined>;
  saveCandidateState(personId: string, state: any): Promise<void>;
}

export interface DecisionSupportStore {
  recordRecommendationRun(run: RecommendationRun): Promise<void>;
  getRecommendationRun(id: string): Promise<RecommendationRun | undefined>;
  
  recordOpportunityAssessment(assessment: OpportunityAssessment): Promise<void>;
  getOpportunityAssessment(id: string): Promise<OpportunityAssessment | undefined>;
  
  recordRecommendationRecord(record: RecommendationRecord): Promise<void>;
  latestRecommendationRecords(personId: string, limit: number): Promise<RecommendationRecord[]>;
  getRecommendationRecordForOpportunity(personId: string, opportunityId: string): Promise<RecommendationRecord | undefined>;
  
  recordUserDecision(personId: string, opportunityId: string, action: string, reason?: string, reviewedFingerprint?: string | null): Promise<void>;
  getUserDecisions(personId: string): Promise<Record<string, { verb: string; updatedAt?: string; reviewedFingerprint?: string | null }>>;
  deleteUserDecision(personId: string, opportunityId: string): Promise<void>;
  clearUserDecisions(personId: string): Promise<void>;
}

// ============================================================================
// 3. STORAGE ABSTRACTION
// ============================================================================

import type { SqliteEvaluationStore } from "../data/sqlite/repositories/SqliteEvaluationStore";

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
}
