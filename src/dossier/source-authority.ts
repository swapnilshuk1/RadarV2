import { createHash } from 'node:crypto';
import { getDatabaseAdapter } from '../data/database';
import { SourceSnapshotResolver } from '../lib/provenance/SourceSnapshotResolver';
import { getBlobStore } from '../lib/storage/blob-store';
import type { DatabaseAdapter } from '../data/database/adapter';
import type { EvidenceSource, SliceInput } from './contracts';

export interface AuthoritativeSliceRequest {
  canonicalJobId: string;
  opportunityVersion: string;
  personId: string;
  candidateDocumentIds: string[];
  candidateName: string;
}

interface OpportunitySnapshotMetadata {
  job_title: string;
  company_name: string | null;
}

export interface AuthoritativeSliceDependencies {
  db: DatabaseAdapter;
  resolver: SourceSnapshotResolver;
}

function fingerprint(parts: readonly string[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex').slice(0, 20);
}

function source(text: string, locator: string, title: string, plane: EvidenceSource['plane'], identity: string): EvidenceSource {
  return {
    id: `${plane.toLowerCase()}-${fingerprint([identity, text])}`,
    text, locator, title, plane, capturedAt: new Date().toISOString(),
    attribution: plane === 'JD' ? 'JOB_POST' : 'CANDIDATE_SUPPLIED',
  };
}

function requireText(text: string | null, description: string): string {
  if (!text?.trim()) throw new Error(`${description} is not readable text; extract it through the canonical acquisition path before generating a dossier.`);
  return text;
}

/**
 * Builds a dossier strictly from immutable source snapshots. The caller names
 * both the opportunity version and every candidate document; there is no
 * latest-document or reconstructed-opportunity fallback.
 */
export async function readAuthoritativeSliceInput(
  request: AuthoritativeSliceRequest,
  dependencies: AuthoritativeSliceDependencies = (() => {
    const db = getDatabaseAdapter();
    return { db, resolver: new SourceSnapshotResolver(db, getBlobStore()) };
  })(),
): Promise<SliceInput> {
  if (!request.candidateDocumentIds.length) throw new Error('Canonical dossier generation requires an explicit candidate document set');
  if (new Set(request.candidateDocumentIds).size !== request.candidateDocumentIds.length) throw new Error('Candidate document set contains a duplicate document identity');

  const metadata = await dependencies.db.one<OpportunitySnapshotMetadata>(
    `SELECT job_title, company_name FROM opportunity_versions WHERE id = ? AND canonical_job_id = ?`,
    [request.opportunityVersion, request.canonicalJobId],
  );
  if (!metadata) throw new Error(`Opportunity snapshot is unavailable for ${request.canonicalJobId}/${request.opportunityVersion}`);

  const opportunityRef = await dependencies.resolver.captureOpportunityVersionRef(request.canonicalJobId, request.opportunityVersion);
  const opportunitySnapshot = await dependencies.resolver.resolve(opportunityRef);
  const jobText = requireText(opportunitySnapshot.text, `Opportunity snapshot ${request.opportunityVersion}`);
  const candidateSources = await Promise.all(request.candidateDocumentIds.map(async documentId => {
    const ref = await dependencies.resolver.captureCandidateDocumentRef(request.personId, documentId);
    const snapshot = await dependencies.resolver.resolve(ref);
    const text = requireText(snapshot.text, `Candidate document ${documentId}`);
    return source(text, `snapshot:candidate:${ref.documentId}:${ref.documentHash}:${ref.textHash}`, `Candidate document ${ref.documentId}`, 'CANDIDATE', `${ref.personId}:${ref.documentId}:${ref.documentHash}:${ref.textHash}`);
  }));

  return {
    opportunity: { id: request.canonicalJobId, company: metadata.company_name || 'Unknown company', title: metadata.job_title },
    candidate: { name: request.candidateName },
    sources: [
      source(jobText, `snapshot:opportunity:${opportunityRef.canonicalJobId}:${opportunityRef.opportunityVersion}:${opportunityRef.contentHash}`, `${metadata.company_name || 'Company'} - immutable opportunity version`, 'JD', `${opportunityRef.canonicalJobId}:${opportunityRef.opportunityVersion}:${opportunityRef.contentHash}:${opportunityRef.sourcePayloadSha256 || ''}`),
      ...candidateSources,
    ],
  };
}
