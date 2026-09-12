/**
 * M4 Domain Models: Canonical Acquisition & Search Plan Candidates
 * 
 * These types establish the boundary between global data acquisition
 * and tenant-scoped attention projections, ensuring strict isolation.
 */

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
