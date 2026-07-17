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

/**
 * Repository Contracts
 * Defined as pure interfaces. Implementations (e.g., SQLite, Postgres) must adhere to these.
 */

// ============================================================================
// 1. GLOBAL LAYER STORES
// ============================================================================

export interface SourceStore {
  recordSource(source: Source): void;
  getSource(id: string): Source | undefined;
}

export interface CompanyStore {
  registerCompany(company: Company): void;
  findByName(name: string): Company | undefined;
}

export interface OpportunityStore {
  mergeOpportunity(opportunity: Opportunity): void;
  getOpportunity(id: string): Opportunity | undefined;
  listActiveOpportunities(): Opportunity[];
  
  findOpportunities(criteria: {
    companyId?: string;
    lifecycle?: string;
  }): Opportunity[];
}

export interface AcquisitionStore {
  recordDocument(document: Document): void;
  logDiscovery(discovery: {
    id: string;
    opportunityId: string;
    executionId: string;
    sourceName: string;
    firstPortal: string;
    firstDefinition: string;
  }): void;
}

export interface KnowledgeStore {
  recordEvidence(evidence: Evidence[]): void;
  recordFacts(facts: Fact[]): void;
  
  findEvidenceForDocument(documentId: string): Evidence[];
  findFactsForOpportunity(opportunityId: string): Fact[];
}

export interface ReasoningStore {
  recordClaims(claims: Claim[]): void;
  findClaimsForOpportunity(opportunityId: string): Claim[];
}

// ============================================================================
// 2. USER-SCOPED LAYER STORES
// ============================================================================

export interface PersonStore {
  registerPerson(person: Person): void;
  getPersonByEmail(email: string): Person | undefined;
  
  saveCandidateProfile(profile: CandidateProfile): void;
  saveResumeVersion(version: ResumeVersion): void;
  
  getCandidateProfile(personId: string, version: string): CandidateProfile | undefined;
  getLatestCandidateProfile(personId: string): CandidateProfile | undefined;
  getResumeVersions(candidateProfileId: string): ResumeVersion[];
}

export interface DecisionSupportStore {
  recordRecommendationRun(run: RecommendationRun): void;
  getRecommendationRun(id: string): RecommendationRun | undefined;
  
  recordOpportunityAssessment(assessment: OpportunityAssessment): void;
  getOpportunityAssessment(id: string): OpportunityAssessment | undefined;
  
  recordRecommendationRecord(record: RecommendationRecord): void;
  latestRecommendationRecords(personId: string, limit: number): RecommendationRecord[];
  getRecommendationRecordForOpportunity(personId: string, opportunityId: string): RecommendationRecord | undefined;
}

// ============================================================================
// 3. STORAGE ABSTRACTION
// ============================================================================

export interface StorageProvider {
  sources: SourceStore;
  companies: CompanyStore;
  opportunities: OpportunityStore;
  acquisition: AcquisitionStore;
  knowledge: KnowledgeStore;
  reasoning: ReasoningStore;
  people: PersonStore;
  decisions: DecisionSupportStore;
}
