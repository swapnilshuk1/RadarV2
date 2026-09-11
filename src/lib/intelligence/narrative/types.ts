import type { KnowledgeSnapshot, EpistemicState } from '../knowledge/model';
import type { EndpointFitness } from '../knowledge/documents';

export interface NarrativeRelationship {
  id: string; relationship: 'MATCH' | 'ADJACENT' | 'GAP' | 'UNKNOWN';
  candidateCapabilityKey: string; jobCapabilityKey: string;
  candidateEvidenceIds: string[]; jobEvidenceIds: string[];
  candidateClaimIds: string[]; jobClaimIds: string[];
  endpointFitness: EndpointFitness;
}
/**
 * A presentation-strength assessment of an already-persisted evaluator
 * relationship. It never changes the evaluator's relationship, score, or
 * decision: it only determines how directly RADAR may explain it to a reader.
 */
export type RelationshipEditorialStrength =
  | 'EXEMPLIFIED'
  | 'GROUNDED'
  | 'CAPABILITY_LEVEL'
  | 'WEAK'
  | 'NON_RENDERABLE';

export interface NarrationRelationship extends NarrativeRelationship {
  editorialStrength?: RelationshipEditorialStrength;
}
export interface CanonicalNarrativeInput {
  identity: { tenantId: string; personId: string; canonicalJobId: string; opportunityVersion: string; contextFingerprint: string };
  company: string; role: string; knowledge: KnowledgeSnapshot;
  evaluation: { state: string; verdict: 'PURSUE' | 'CONSIDER' | 'PASS' | null; score: number | null; fingerprint: string | null };
  relationships: NarrationRelationship[];
  drivers: Array<{ dimension: string; state: string; evidenceIds: string[] }>;
}
export interface NarrativeInsight {
  id: string; purpose: string; claimIds: string[]; relationshipIds: string[];
  interpretation: EpistemicState; importance: number;
  text: string; consequence?: string; recommendation?: string;
}
export interface NarrativePattern { id: string; family: string; skeleton: string; editorialPurpose: string }
export interface CanonicalNarrativePresentation {
  version: 'canonical-narrative-shadow/v1'; inputHash: string;
  identity: CanonicalNarrativeInput['identity']; evaluation: CanonicalNarrativeInput['evaluation'];
  pattern: NarrativePattern; blueprint: string;
  blocks: Array<{ id: string; kind: string; title: string; sentences: Array<{ text: string; insightIds: string[]; claimIds: string[]; relationshipIds: string[]; epistemicState: EpistemicState }> }>;
}
