/**
 * Canonical Knowledge Model
 * ADR-001: RADAR Executive Intelligence Platform
 */

// ============================================================================
// Core Versioning & Metadata
// ============================================================================
export interface Provenance {
  schemaVersion: string;
  extractorVersion?: string;
  promptVersion?: string;
  model?: string;
  runId?: string; // Links to the operational run
  timestamp: string; // ISO-8601 when this was derived
}

export interface IntelligenceLedger {
  id: string; // e.g. ULID
  pipeline: string;
  pipelineVersion: string;
  rule?: string;
  ruleVersion?: string;
  model?: string;
  promptVersion?: string;
  schemaVersion: string;
  createdAt: string; // ISO-8601
  inputsHash: string;
  outputHash: string;
}

export interface EntityBase {
  id: string;
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  provenance: Provenance;
  ledgerId?: string; // Fk -> IntelligenceLedger.id
}

// ============================================================================
// 1. GLOBAL LAYER (Owned by the System, Shared by Everyone)
// ============================================================================

export interface Source extends EntityBase {
  type: "LinkedIn" | "Indeed" | "CompanyCareers" | "News" | "PressRelease" | "AnnualReport" | "Glassdoor" | "Recruiter";
  url?: string;
  name?: string;
}

export interface Company extends EntityBase {
  name: string;
  industry?: string;
  hq?: string;
  size?: string;
  techStack?: string[];
  
  // Future Signals
  hiringVelocity?: number;
  growthSignal?: "Expanding" | "Stable" | "Contracting";
}

export type OpportunityLifecycle = "Discovered" | "Normalized" | "Verified" | "Archived";

export interface Opportunity extends EntityBase {
  companyId: string; // Fk -> Company.id
  
  // Identity Strategy Fields
  canonicalTitle: string; 
  location?: string;
  employmentType?: string;
  postingWindow?: string;
  fingerprint: string; // The deterministic hash for deduplication
  
  lifecycle: OpportunityLifecycle;
}

export type DocumentLifecycle = "Captured" | "Parsed" | "Validated" | "Superseded";

/** Replaces "Extraction". Represents the physical payload from a Source. */
export interface Document extends EntityBase {
  sourceId: string; // Fk -> Source.id
  opportunityId?: string; // Fk -> Opportunity.id (optional if document is general company news)
  payloadType: "HTML" | "Text" | "PDF" | "Structured";
  content: string; 
  lifecycle: DocumentLifecycle;
}

export interface Evidence extends EntityBase {
  documentId: string; // Fk -> Document.id
  text: string;
  section?: string;
  qualityScore: number;
}

export interface Fact extends EntityBase {
  opportunityId: string;
  evidenceIds: string[]; // Fk -> Evidence.id
  attribute: string;
  value: any; // e.g. "₹65L"
  // Facts are Immutable
}

export type ReasoningType = "Deterministic" | "LLM" | "Hybrid" | "External";

export interface Inference extends EntityBase {
  opportunityId: string;
  reasoningType: ReasoningType;
  rule: string; // The semantic rule, e.g., "ExecutiveLeadership"
  factIds: string[]; // Fk -> Fact.id (The inputs to this reasoning)
  confidence: number;
  output: any; // The derived conclusion
}

export interface Claim extends EntityBase {
  opportunityId: string;
  inferenceIds: string[]; // Fk -> Inference.id
  statement: string; // e.g. "Excellent executive fit"
  confidence: number;
  // Claims are Versioned
}

/** 
 * ReasoningGraph is the Aggregate Root that encapsulates the entire explainability chain.
 * A Recommendation points to a version of a ReasoningGraph rather than loose artifacts.
 */
export interface ReasoningGraph extends EntityBase {
  opportunityId: string;
  version: string;
  evidence: Evidence[];
  facts: Fact[];
  inferences: Inference[];
  claims: Claim[];
  ledgers: IntelligenceLedger[]; // All ledgers referenced in this graph
}

// ============================================================================
// 2. USER-SCOPED LAYER (Owned by the Person)
// ============================================================================

export interface Person extends EntityBase {
  email: string;
}

export interface CandidateProfile extends EntityBase {
  personId: string; // Fk -> Person.id
  version: string;
  experience: any[];
  industries: string[];
  leadership: string[];
  international: string[];
  transformation: string[];
  technology: string[];
  pnl: string[];
  functions: string[];
  skills: string[];
  preferences: Record<string, any>;
  hardConstraints: string[];
  softConstraints: string[];
}

export interface RecommendationPolicy extends EntityBase {
  version: string;
  name: string;
  description: string;
  weights: Record<string, number>;
  rules: any[];
}

export interface ResumeVersion extends EntityBase {
  candidateProfileId: string; // Fk -> CandidateProfile.id
  type: "Executive" | "Board" | "Consulting" | "Standard";
  achievements: string[];
  customStatement?: string;
}

export interface RecommendationRun extends EntityBase {
  candidateProfileVersion: string;
  recommendationPolicyVersion: string;
  graphVersion: string;
  startedAt: string;
  completedAt?: string;
  jobsEvaluated: number;
  recommendationsGenerated: number;
}

export interface MissingEvidence {
  dimension: string;
  category: "Critical" | "Nice to Have" | "Unknown";
}

export interface RecommendationReason {
  type: "Strength" | "Gap" | "Risk" | "Info";
  severity: "High" | "Medium" | "Low";
  dimension: string;
  score: number;
  message: string;
}

export interface DecisionImpact {
  attribute: string;
  impactScore: number;    // Delta contribution to overall score
  direction: "UP" | "DOWN";
  narrative: string;      // Plain-English consequence
}

export interface DecisionConfidence {
  overall: number | null; // 0.0 to 1.0 calibrated decision confidence; null when unavailable
  stability: number;      // 0.0 to 1.0 likelihood of recommendation hold
  limitingDimensions: DecisionImpact[]; // Dimensions capping overall confidence
  explanation: string;    // Actionable plain-English guidance
}

/** Persistent deterministic assessment object */
export interface OpportunityAssessment extends EntityBase {
  jobId: string; // Fk -> Opportunity.id
  candidateProfileId: string; // Fk -> CandidateProfile.id
  recommendationRunId: string; // Fk -> RecommendationRun.id
  
  score: number;
  dataConfidence: number;
  modelConfidence: number;
  recommendationConfidence: number;
  
  decision: "Excellent" | "Good" | "Average" | "Weak Fit" | "Needs More Evidence";
  reasons: RecommendationReason[];
  missingEvidence: MissingEvidence[];
  strategicNotes?: string;
  actions?: string[];
  decisionConfidence?: DecisionConfidence;
}

/** Disposable generated presentation layer */
export interface RecommendationRecord {
  recommendationVersion: string;
  candidateProfileVersion: string;
  jobHash: string;
  graphVersion: string;
  
  overallScore: number;
  confidence: number;
  recommendation: string;
  
  dimensionScores: Record<string, number>;
  strengths: RecommendationReason[];
  gaps: RecommendationReason[];
  missingEvidence: MissingEvidence[];
  riskFlags: RecommendationReason[];
  
  salaryEstimate?: string;
  promotionPotential?: string;
  careerTrajectory?: string;
  
  whyRecommended?: string;
  whyRejected?: string;
  nextBestActions?: string[];
}

// ============================================================================
// 3. INTELLIGENCE PIPELINES (Signal & Memory)
// ============================================================================

export type SignalSeverity = "Info" | "Minor" | "Major" | "Critical";
export type SignalDirection = "Positive" | "Negative" | "Neutral";

export interface Signal extends EntityBase {
  category: EventCategory;
  severity: SignalSeverity;
  priority: "Low" | "Medium" | "High" | "Immediate";
  direction: SignalDirection;
  supersedesId?: string; // Signals are immutable. If evolved, they supersede an older signal.
  evidenceId: string; // Fk -> Evidence.id (Strict trace to evidence)
  description: string;
}

export interface ChangeSet extends EntityBase {
  baseGraphVersion: string;
  targetGraphVersion: string;
  structuralChanges: any[]; // e.g. added/removed facts
  semanticChanges: any[]; // e.g. confidence changed, inferences changed
  affectedEntities: string[]; // Fk -> Entity.id
}

// ============================================================================
// 4. EVENT SOURCING & TIMELINE (CQRS Foundation)
// ============================================================================

export interface Workspace extends EntityBase {
  createdBy: string; // Fk -> Person.id
  owner: string; // Fk -> Person.id
  name: string;
  configurationVersion: string;
}

export type EventCategory = 
  | "Acquisition" 
  | "Graph" 
  | "Recommendation" 
  | "Decision" 
  | "Outcome" 
  | "Signal" 
  | "Memory" 
  | "System"
  | "External";

export interface Prediction extends EntityBase {
  opportunityAssessmentId: string; // Fk -> OpportunityAssessment.id
  version: string;
  generatedBy: "Rule Engine" | "LLM" | "Hybrid";
  expectedProbability: number;
  expectedFunnel: string;
  expectedDurationDays: number;
  expectedCompensation: string;
  expectedRisks: string[];
}

export interface RecommendationSnapshot extends EntityBase {
  snapshotHash: string; // Derived from Assessment, Recommendation, Prediction, Prompt, Model, Graph Version
  personId: string;
  opportunityId: string;
  recommendationId: string;
  
  confidence: number;
  summary: string;
  promptVersion: string;
  model: string;
  graphVersion: string; // Or timestamp
}

export interface TimelineEvent {
  id: string; // UUIDv7 or ULID
  workspaceId: string;
  personId: string;
  opportunityId?: string; // Optional if event is user-level, e.g. ResumeUpdated
  
  aggregateType: "Opportunity" | "Person" | "Workspace" | "Recommendation";
  aggregateId: string;

  eventCategory: EventCategory;
  eventType: string; // e.g., "DecisionMade", "OfferAccepted", "CompanyLayoffs"
  eventVersion: number;
  occurredAt: string; // ISO-8601
  
  recommendationSnapshotId?: string; // Fk -> RecommendationSnapshot.id
  
  payloadJson: string; // Typed JSON string specific to eventType
  metadataJson: string; // e.g. user agent, UI session
  
  provenance: Provenance;
}

// ============================================================================
// Capability Engine Contracts (ADR-002: Capability Profile Abstraction)
// ============================================================================

export type SourceDimension = "technologyStack" | "mandate" | "commercialAccountability" | "reportingLine";

export interface EvidenceReference {
  dimension: SourceDimension;
  quote?: string;         // Direct text segment/citation from the source JD if applicable
  matchedValue?: string;  // e.g., "Meta", "Salesforce", "Turnaround"
  confidence?: number;    // Extraction confidence metric [0-1]
}

export interface Capability {
  id: string;             // Unique identifier for the capability, e.g., "cap_crm_leadership"
  name: string;           // Human-readable capability name, e.g., "CRM Leadership"
  strength: "Strong" | "Moderate" | "Weak";
  confidence: number;     // Aggregated calibration confidence
  supportingEvidence: EvidenceReference[];
  sourceDimensions: SourceDimension[];
}

// ============================================================================
// Platform Intelligence Contracts (P7-B / P7-C Platform Intelligence)
// ============================================================================

export type SignalAvailabilityState = "AVAILABLE" | "UNAVAILABLE" | "NOT_APPLICABLE" | "UNKNOWN";

export interface ValueWithAvailability<T> {
  value: T | null;
  state: SignalAvailabilityState;
  provenanceNote?: string;
}

export interface PlatformIntelligence {
  source: "LinkedIn" | "Naukri" | "Indeed" | "Workday" | "Greenhouse" | "Lever" | "SmartRecruiters" | "CompanySite";
  accountConnected: boolean;
  membershipTier: "FREE" | "PREMIUM" | "RECRUITER" | "UNKNOWN";
  retrievedAt?: string;
  provenanceMode?: "FIXTURE" | "LOCAL_EXPERIMENT" | "LIVE_AUTHORIZED";

  applicantCount: ValueWithAvailability<number>;
  applicantRankPercentile: ValueWithAvailability<number>;
  topApplicantBadge: ValueWithAvailability<boolean>;
  seniorApplicantRatio: ValueWithAvailability<number>;

  platformMatchScore: ValueWithAvailability<number>;
  platformRecommendationBadge: ValueWithAvailability<string>;
  platformSkillMatchCount: ValueWithAvailability<{ matched: number; total: number }>;
  platformExperienceMatch: ValueWithAvailability<boolean>;

  recruiterActiveRecently: ValueWithAvailability<boolean>;
  hiringManagerName: ValueWithAvailability<string>;
  companyHeadcountGrowthYoY: ValueWithAvailability<number>;

  sourceFreshnessAgeDays: ValueWithAvailability<number>;
}

