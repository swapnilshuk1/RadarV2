export interface CandidateDocumentSourceRef {
  readonly kind: "CANDIDATE_DOCUMENT_TEXT";
  readonly personId: string;
  readonly documentId: string;
  readonly documentHash: string;
  readonly textHash: string;
}

export interface OpportunityVersionSourceRef {
  readonly kind: "OPPORTUNITY_VERSION";
  readonly canonicalJobId: string;
  readonly opportunityVersion: string;
  readonly contentHash: string;
  readonly sourcePayloadKey: string | null;
  readonly sourcePayloadSha256: string | null;
}

export type CanonicalSourceRef = CandidateDocumentSourceRef | OpportunityVersionSourceRef;
