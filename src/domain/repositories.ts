import type {
  Company,
  Opportunity,
  SourceListing,
  Extraction,
  Evidence,
  Fact,
  Claim,
  Person,
  CareerProfile,
  PreferenceProfile,
  Match,
  Recommendation,
  Decision,
  Outcome
} from "./entities";

/**
 * Repository Contracts
 * Defined as pure interfaces. Implementations (e.g., SQLite, Postgres) must adhere to these.
 */

// ============================================================================
// 1. GLOBAL LAYER STORES
// ============================================================================

export interface CompanyStore {
  registerCompany(company: Company): void;
  findByName(name: string): Company | undefined;
  updateIntelligenceSignals(id: string, signals: Partial<Company>): void;
}

export interface OpportunityStore {
  mergeOpportunity(opportunity: Opportunity): void;
  recordListing(listing: SourceListing): void;
  getOpportunity(id: string): Opportunity | undefined;
  listActiveOpportunities(): Opportunity[];
  
  findOpportunities(criteria: {
    level?: string;
    industry?: string;
    minScore?: number;
    status?: string;
  }): Opportunity[];
}

export interface AcquisitionStore {
  recordExtraction(extraction: Extraction): void;
}

export interface KnowledgeStore {
  recordEvidence(evidence: Evidence[]): void;
  recordFacts(facts: Fact[]): void;
  
  findEvidenceForOpportunity(opportunityId: string): Evidence[];
  findFactsForOpportunity(opportunityId: string): Fact[];
}

export interface ReasoningStore {
  // Claims are Global: they interpret Facts without a specific Person's context.
  recordClaims(claims: Claim[]): void;
  findClaimsForOpportunity(opportunityId: string): Claim[];
}

// ============================================================================
// 2. USER-SCOPED LAYER STORES
// ============================================================================

export interface PersonStore {
  registerPerson(person: Person): void;
  getPersonByEmail(email: string): Person | undefined;
  
  saveCareerProfile(profile: CareerProfile): void;
  getCareerProfile(personId: string): CareerProfile | undefined;
  
  savePreferenceProfile(profile: PreferenceProfile): void;
  getPreferenceProfile(personId: string): PreferenceProfile | undefined;
}

export interface DecisionSupportStore {
  recordMatch(match: Match): void;
  findMatches(personId: string, opportunityId?: string): Match[];
  
  recordRecommendation(recommendation: Recommendation): void;
  latestRecommendations(personId: string, limit: number): Recommendation[];
  getRecommendationForOpportunity(personId: string, opportunityId: string): Recommendation | undefined;
}

export interface UserOutcomeStore {
  recordDecision(decision: Decision): void;
  recordOutcome(outcome: Outcome): void;
}

// ============================================================================
// 3. STORAGE ABSTRACTION
// ============================================================================

export interface StorageProvider {
  companies: CompanyStore;
  opportunities: OpportunityStore;
  acquisition: AcquisitionStore;
  knowledge: KnowledgeStore;
  reasoning: ReasoningStore;
  people: PersonStore;
  decisions: DecisionSupportStore;
  outcomes: UserOutcomeStore;
}

