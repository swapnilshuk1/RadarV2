/**
 * Canonical Knowledge Model
 * Sprint 2: Foundation for the RADAR Executive Intelligence Platform
 * Multi-User Architecture
 */

// ============================================================================
// Core Versioning & Metadata
// ============================================================================
export interface VersionMetadata {
  schemaVersion: string;
  extractorVersion?: string;
  promptVersion?: string;
  model?: string;
  benchmarkVersion?: string;
}

export interface EntityBase {
  id: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  _meta: VersionMetadata;
}

// ============================================================================
// 1. GLOBAL LAYER (Owned by the System, Shared by Everyone)
// ============================================================================

export interface Company extends EntityBase {
  name: string;
  industry?: string;
  hq?: string;
  size?: string;
  techStack?: string[];
  
  // Evolving Intelligence Signals (Shared Intelligence)
  hiringVelocity?: number;
  growthSignal?: "Expanding" | "Stable" | "Contracting";
  leadershipChanges?: string;
  technologyAdoption?: string;
  executiveTurnover?: string;
}

export interface Opportunity extends EntityBase {
  companyId: string; // Fk -> Company.id
  canonicalRole: string; // The normalized title (e.g. "VP Marketing")
  status: "Active" | "Closed" | "Stale";
}

export interface SourceListing extends EntityBase {
  opportunityId: string; // Fk -> Opportunity.id
  portal: "LinkedIn" | "Indeed" | "Naukri" | "CompanyCareers" | "Referral" | string;
  url: string;
  postedAt?: string;
  recruiter?: string;
  salaryMetadata?: string;
  rawHtmlPath?: string; // Pointer to immutable evidence file
}

export interface Extraction extends EntityBase {
  sourceListingId: string; // Fk -> SourceListing.id
  rawJson: string; // The direct output of the LLM extraction phase
}

export interface Evidence extends EntityBase {
  sourceListingId: string; // Fk -> SourceListing.id
  text: string;
  sourceType: "title" | "snippet" | "responsibilities" | "requirements" | "other";
  qualityScore: number;
}

export interface Fact extends EntityBase {
  opportunityId: string;
  evidenceIds: string[]; // Fk -> Evidence.id
  attribute: string;
  value: any;
}

export interface Claim extends EntityBase {
  opportunityId: string;
  factIds: string[]; // Fk -> Fact.id
  statement: string; // e.g. "Role requires heavy commercial alignment"
  confidence: number;
}

// ============================================================================
// 2. USER-SCOPED LAYER (Owned by the Person)
// ============================================================================

export interface Person extends EntityBase {
  email: string;
  // Auth logic is deferred, but we maintain the identity root
}

export interface CareerProfile extends EntityBase {
  personId: string; // Fk -> Person.id
  timeline: any[]; // Structured career timeline
  skills: string[];
  achievements: string[];
}

export interface PreferenceProfile extends EntityBase {
  personId: string; // Fk -> Person.id
  remote: boolean;
  preferredIndustries: string[];
  targetCompensation?: string;
  travelWillingness?: string;
  companySize?: string[];
  international: boolean;
  startups: boolean;
  publicCompanies: boolean;
}

export interface Match extends EntityBase {
  personId: string; // Fk -> Person.id
  opportunityId: string; // Fk -> Opportunity.id
  
  // Multidimensional matching based on Person's Career/Preferences vs Global Claims
  capabilityScore: number;
  careerProgressionScore: number;
  strategicValueScore: number;
  lifestyleScore: number;
  overallConfidence: number;
}

export interface Recommendation extends EntityBase {
  personId: string; // Fk -> Person.id
  opportunityId: string;
  matchId: string; // Fk -> Match.id
  
  // Immutable document for this specific person
  summary: string;
  reasons: string[];
  risks: string[];
  unknowns: string[];
  supportingClaims: string[];
  
  promptVersion: string;
  model: string;
}

export interface Decision extends EntityBase {
  personId: string; // Fk -> Person.id
  opportunityId: string;
  recommendationId?: string; // Fk -> Recommendation.id
  action: "Pursue" | "Consider" | "Pass" | "Apply";
  reason?: string;
}

export interface Outcome extends EntityBase {
  personId: string; // Fk -> Person.id
  opportunityId: string;
  decisionId: string; // Fk -> Decision.id
  result: "Rejected After Interview" | "Ghosted" | "Offer Extended" | "Company Laid Off" | string;
  learnedReason?: string; // Feeds back into memory
}
