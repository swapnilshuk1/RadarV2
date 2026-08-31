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
  | 'EVALUATED'
  | 'EXPIRED';

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
