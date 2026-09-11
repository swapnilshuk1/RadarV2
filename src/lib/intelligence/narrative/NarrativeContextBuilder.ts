import { digest, usable } from '../knowledge/model';
import { endpointFitness } from '../knowledge/documents';
import type { CanonicalNarrativeInput, NarrativeInsight, NarrationRelationship, RelationshipEditorialStrength } from './types';
export function narrativeContext(input: CanonicalNarrativeInput) {
  const claims = input.knowledge.claims.filter(c => usable(c, 'narration'));
  const byId = new Map(claims.map(c => [c.id, c]));
  const work = claims.filter(c => c.predicate === 'role.responsibility' || c.predicate === 'role.outcome' || c.predicate === 'role.published_evidence');
  const qualifications = claims.filter(c => c.predicate === 'role.qualification');
  const company = claims.filter(c => c.subject.type === 'COMPANY');
  const relationships = input.evaluation.state === 'EVALUATED' ? input.relationships
    .map(relationship => ({ ...relationship, editorialStrength: relationshipStrength(relationship, byId) }))
    .filter(relationship => relationship.editorialStrength !== 'NON_RENDERABLE') : [];
  return { input, claims, byId, work, qualifications, company, relationships };
}
export type NarrativeContext = ReturnType<typeof narrativeContext>;

/**
 * This is deliberately a presentation judgement, not a second evaluator. A
 * persisted MATCH remains a MATCH at every strength; weaker source endpoints
 * merely require more qualified reader-facing language.
 */
export function relationshipStrength(
  relationship: NarrationRelationship,
  byId: ReadonlyMap<string, { displayText?: string; predicate: string }>,
): RelationshipEditorialStrength {
  const candidate = relationship.candidateClaimIds.map(id => byId.get(id)).filter(Boolean);
  const job = relationship.jobClaimIds.map(id => byId.get(id)).filter(Boolean);
  if (!candidate.length || !job.length || relationship.endpointFitness === 'MALFORMED') return 'NON_RENDERABLE';
  const candidateText = candidate.map(claim => claim?.displayText ?? '').join(' ');
  const jobText = job.map(claim => claim?.displayText ?? '').join(' ');
  const substantiveCandidate = /\b(?:led|owned|managed|built|delivered|drove|grew|launched|ran|responsible|accountable|experience|years|market|portfolio|team)\b/i.test(candidateText);
  const readableJob = endpointFitness(jobText) === 'DIRECT' || endpointFitness(jobText) === 'COMPOUND';
  if (substantiveCandidate && readableJob && /\b(?:\d|%|₹|\$|million|markets?|portfolio|team)\b/i.test(candidateText)) return 'EXEMPLIFIED';
  if (substantiveCandidate && readableJob) return 'GROUNDED';
  if (relationship.candidateEvidenceIds.length || relationship.jobEvidenceIds.length || candidateText || jobText) return 'CAPABILITY_LEVEL';
  return 'WEAK';
}
export function insight(purpose: string, text: string, claimIds: string[], importance: number, interpretation: NarrativeInsight['interpretation'] = 'SYNTHESIZED', relationshipIds: string[] = []): NarrativeInsight {
  return { id: digest([purpose, text, claimIds, relationshipIds]), purpose, text, claimIds, importance, interpretation, relationshipIds };
}
