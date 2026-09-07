/**
 * M4 Domain Models: Canonical Acquisition, Provenance & Search Plan Candidates
 * 
 * These types establish the boundary between global data acquisition,
 * orthogonal provenance state dimensions, and tenant-scoped attention projections.
 */

export type AcquisitionStatus =
  | 'UNKNOWN'
  | 'ACQUIRED'
  | 'RECOVERY_PENDING'
  | 'RECOVERY_FAILED'
  | 'CAPTURE_FAILED';

export type AcquisitionQuality =
  | 'UNKNOWN'
  | 'COMPLETE'
  | 'PARTIAL'
  | 'MINIMAL'
  | 'INVALID';

export type LifecycleState =
  | 'UNKNOWN'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'REMOVED_404';

export type EvidenceState =
  | 'UNVERIFIED'
  | 'SUFFICIENT'
  | 'GENUINELY_SPARSE';

export type EvaluationState =
  | 'UNKNOWN'
  | 'ACQUISITION_PENDING'
  | 'ACQUISITION_FAILED'
  | 'SPARSE_SPEC'
  | 'NOT_EVALUABLE'
  | 'EVALUATED'
  | 'EXPIRED';

/**
 * The authoritative boundary between a fetched portal response and anything
 * allowed to enter job projection.  HTTP success alone is deliberately not a
 * usable job document: a redirect page, portal shell, or PDF byte stream is
 * useful acquisition evidence but must never be interpreted as a JD.
 */
export type DocumentTransportState = 'SUCCEEDED' | 'REDIRECTED' | 'FAILED';
export type DocumentExtractionState = 'EXTRACTED' | 'PENDING' | 'FAILED' | 'NOT_ATTEMPTED';
export type DocumentUsabilityState = 'SUBSTANTIVE' | 'GENUINELY_SPARSE' | 'UNUSABLE';

export interface ValidatedJobDocument {
  source: string;
  sourceJobId?: string;
  canonicalUrl: string;
  finalUrl: string;
  contentType: string | null;
  transportState: DocumentTransportState;
  extractionState: DocumentExtractionState;
  usabilityState: DocumentUsabilityState;
  acquisitionQuality: AcquisitionQuality;
  title: string | null;
  company: string | null;
  location: string | null;
  titleAgreement: 'MATCHED' | 'MISMATCHED' | 'UNKNOWN';
  companyAgreement: 'MATCHED' | 'MISMATCHED' | 'UNKNOWN';
  substantiveWordCount: number;
  substantiveCharacterCount: number;
  boilerplateRatio: number;
  scriptRatio: number;
  failureClass: string | null;
  retryable: boolean;
  extractedText: string | null;
  provenance: 'HTTP' | 'BROWSER' | 'JSON_LD' | 'TARGETED_DOM' | 'SANITIZED_DOM' | 'BLOB';
}

export interface CanonicalOpportunity {
  id: string; // Deterministic SHA256 of Canonical Serialization
  source: string;
  sourceJobId: string;
  canonicalUrl: string;
  companyName: string | null;
  createdAt: string;
  lastSeenAt: string;
}

export interface OpportunityVersion {
  id: string; // Deterministic Hash or ULID
  canonicalJobId: string;
  contentHash: string;
  jobTitle: string;
  companyName: string | null;
  location: string | null;
  employmentType: string | null;
  rawContent: string;
  acquisitionStatus: AcquisitionStatus;
  acquisitionQuality: AcquisitionQuality;
  failureClass?: string | null;
  lifecycleState: LifecycleState;
  evidenceState: EvidenceState;
  sourcePayloadKey?: string | null;
  sourceMediaType?: string | null;
  documentExtractionState?: DocumentExtractionState | null;
  createdAt: string;
}

export type AttentionDecision = 'CANDIDATE' | 'NOT_CANDIDATE';

export interface SearchPlanCandidate {
  tenantId: string;
  personId: string;
  searchPlanId: string;
  canonicalJobId: string;
  opportunityVersion: string;
  attentionDecision: AttentionDecision;
  eligibility?: "ELIGIBLE" | "REVIEW" | "INELIGIBLE";
  eligibilityReasonCodes?: string[];
  locationPolicy?: string | null;
  locationEvidence?: string | null;
  createdAt: string;
}

export type RecoveryQueueStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'RECOVERED'
  | 'EXHAUSTED'
  | 'GENUINELY_SPARSE';

export interface RecoveryQueueItem {
  id: string;
  tenantId: string;
  canonicalJobId: string;
  opportunityVersionId: string;
  source: string;
  canonicalUrl: string;
  reason: string;
  failureClass: string;
  attemptCount: number;
  status: RecoveryQueueStatus;
  nextAttemptAt: string;
  lastAttemptAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  completedAt?: string | null;
}
