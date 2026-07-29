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
  
  findOpportunities(criteria: {
    companyId?: string;
    lifecycle?: string;
  }): Promise<Opportunity[]>;
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
  
  saveCandidateProfile(profile: CandidateProfile): Promise<void>;
  saveResumeVersion(version: ResumeVersion): Promise<void>;
  
  getCandidateProfile(personId: string, version: string): Promise<CandidateProfile | undefined>;
  getLatestCandidateProfile(personId: string): Promise<CandidateProfile | undefined>;
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
  
  recordUserDecision(personId: string, opportunityId: string, action: string, reason?: string): Promise<void>;
  getUserDecisions(personId: string): Promise<Record<string, { verb: string; updatedAt?: string }>>;
  deleteUserDecision(personId: string, opportunityId: string): Promise<void>;
  clearUserDecisions(personId: string): Promise<void>;
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
