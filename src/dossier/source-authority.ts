import { createHash } from 'node:crypto';
import { getRepositories } from '../data/sqlite/provider';
import type { EvidenceSource, SliceInput } from './contracts';

export interface AuthoritativeSliceRequest {
  jobHash: string;
  personId: string;
  candidateDocumentIds?: string[];
  candidateName: string;
}

function source(text: string, locator: string, title: string, plane: EvidenceSource['plane']): EvidenceSource {
  return {
    id: `${plane.toLowerCase()}-${createHash('sha256').update(locator + text).digest('hex').slice(0, 16)}`,
    text, locator, title, plane, capturedAt: new Date().toISOString(),
    attribution: plane === 'JD' ? 'JOB_POST' : 'CANDIDATE_SUPPLIED',
  };
}

/** Builds a dossier from RADAR's persisted raw sources, never from a prior projection or dossier. */
export async function readAuthoritativeSliceInput(request: AuthoritativeSliceRequest): Promise<SliceInput> {
  const repos = getRepositories();
  const opportunity = await repos.opportunities.getOpportunitySource(request.jobHash);
  const rawJobText = opportunity?.rawText;
  if (!opportunity || !rawJobText?.trim()) throw new Error(`Canonical opportunity ${request.jobHash} has no usable raw JD`);
  const ids = request.candidateDocumentIds?.length ? request.candidateDocumentIds : [(await repos.documents.getLatestDocumentForPerson(request.personId))?.id].filter((id): id is string => Boolean(id));
  if (!ids.length) throw new Error(`No candidate document is available for ${request.personId}`);
  const candidates = await Promise.all(ids.map(async id => {
    const document = await repos.documents.getDocument(id);
    if (!document || document.personId !== request.personId) throw new Error(`Candidate document ${id} is unavailable to this person`);
    const content = await repos.documents.getDocumentContent(id);
    const rawCandidateText = content?.rawText;
    if (!rawCandidateText?.trim()) throw new Error(`Candidate document ${id} has no extracted text`);
    return source(rawCandidateText, `candidate-document:${document.id}:${document.documentHash}`, document.filename, 'CANDIDATE');
  }));
  return {
    opportunity: { id: opportunity.jobHash, company: opportunity.company, title: opportunity.role },
    candidate: { name: request.candidateName },
    sources: [source(rawJobText, `canonical-opportunity:${opportunity.jobHash}`, `${opportunity.company} — original scraped JD`, 'JD'), ...candidates],
  };
}
