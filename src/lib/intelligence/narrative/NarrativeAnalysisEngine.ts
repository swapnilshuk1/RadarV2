import { digest } from '../knowledge/model';
import type { JsonModel } from '../knowledge/model-provider';
import type { CanonicalNarrativeInput, NarrativeInsight } from './types';

export interface BoundNarrativeMove {
  id: string;
  kind: string;
  title: string;
  claimIds: string[];
  relationshipIds: string[];
  task: string;
}

/**
 * The analyst may make explicit, bounded interpretations. It receives semantic
 * handles rather than database identities; the orchestrator is the sole place
 * that resolves those handles back to canonical claim IDs.
 */
export class NarrativeAnalysisEngine {
  constructor(private readonly model: JsonModel) {}
  async analyze(input: CanonicalNarrativeInput, moves: readonly BoundNarrativeMove[]): Promise<NarrativeInsight[]> {
    // The analyst sees only evidence already bound to a planning move. This is
    // both the lineage boundary and a guard against dumping a whole candidate
    // inventory into a context window.
    const selectedIds = new Set(moves.flatMap(move => move.claimIds));
    const claims = new Map<string, CanonicalNarrativeInput['knowledge']['claims'][number]>(input.knowledge.claims.filter(claim => selectedIds.has(claim.id)).map((claim, index) => [`${claim.subject.type}_${index + 1}`, claim]));
    const claimHandle = new Map<string, string>([...claims.entries()].map(([handle, claim]) => [claim.id, handle]));
    const relationships = new Map<string, CanonicalNarrativeInput['relationships'][number]>(input.relationships.map((relationship, index) => [`RELATION_${index + 1}`, relationship]));
    const request = {
      moves: moves.map(move => ({ id: move.id, kind: move.kind, task: move.task, claimHandles: move.claimIds.map(id => claimHandle.get(id)), relationshipHandles: move.relationshipIds.map(id => [...relationships.entries()].find(([, relation]) => relation.id === id)?.[0]) })),
      claims: [...claims.entries()].map(([handle, claim]) => ({ handle, subject: claim.subject.type, predicate: claim.predicate, text: claim.displayText, state: claim.epistemicState })),
      relationships: [...relationships.entries()].map(([handle, relation]) => ({ handle, relationship: relation.relationship, candidateCapability: relation.candidateCapabilityKey, jobCapability: relation.jobCapabilityKey, strength: relation.editorialStrength })),
    };
    let response: unknown;
    for (let attempt = 0; attempt < 2; attempt++) try {
      response = await this.model.generate(`You are RADAR's analyst. For each supplied move, propose one compact interpretation, consequence, question, or positioning insight. Return only JSON {insights:[{moveId,text,state,claimHandles,relationshipHandles}]}. Return at most one insight per move. Handles are machine-only citations: NEVER write a handle such as ROLE_1, COMPANY_2, CANDIDATE_3, or RELATION_1 in text. Return the handles only in their array fields. You may synthesize connections and hypotheses, but label them INFERRED, ASSUMED, or SYNTHESIZED. Never call a synthesis OBSERVED or EXTRACTED. Use only handles explicitly supplied to that move. A recommendation is not proof of fit. Do not alter evaluator score or verdict; a capability-level evaluator relation is useful but must be described with appropriate modesty.`, request);
      break;
    } catch (error) {
      if (attempt === 1) throw error;
    }
    if (!response || typeof response !== 'object' || !Array.isArray((response as any).insights)) return [];
    const moveById = new Map(moves.map(move => [move.id, move]));
    const result: NarrativeInsight[] = [];
    for (const item of (response as any).insights) {
      const move = moveById.get(item?.moveId);
      if (!move || typeof item?.text !== 'string' || !item.text.trim() || !Array.isArray(item.claimHandles) || !Array.isArray(item.relationshipHandles)) continue;
      const allowedClaims = new Set(move.claimIds.map(id => claimHandle.get(id)));
      const allowedRelationships = new Set(move.relationshipIds.map(id => [...relationships.entries()].find(([, relation]) => relation.id === id)?.[0]));
      if (item.claimHandles.some((handle: unknown) => typeof handle !== 'string' || !allowedClaims.has(handle)) || item.relationshipHandles.some((handle: unknown) => typeof handle !== 'string' || !allowedRelationships.has(handle))) continue;
      const state = item.state;
      if (!['INFERRED', 'ASSUMED', 'SYNTHESIZED'].includes(state) || !item.claimHandles.length) continue;
      const claimIds = item.claimHandles.map((handle: string) => claims.get(handle)!.id);
      const relationshipIds = item.relationshipHandles.map((handle: string) => relationships.get(handle)!.id);
      result.push({ id: digest(['model-analysis/v1', move.id, item.text, claimIds, relationshipIds]), purpose: move.kind, text: item.text.trim(), claimIds, relationshipIds, interpretation: state, importance: 100 });
    }
    return result;
  }
}
