import { digest } from '../knowledge/model';
import { narrativeContext } from './NarrativeContextBuilder';
import { narrativeSynthesizers } from './synthesizers';
import type { CanonicalNarrativeInput, CanonicalNarrativePresentation, NarrativeInsight, NarrativePattern } from './types';

export interface NarrativeRealizer { realize(input: CanonicalNarrativeInput, insights: NarrativeInsight[], pattern: NarrativePattern): Promise<CanonicalNarrativePresentation> }
export function NarrativeBlueprintSelector(input: CanonicalNarrativeInput): string {
  if (input.evaluation.state !== 'EVALUATED') return 'SOURCE_RESEARCH_BRIEF';
  if (input.evaluation.verdict === 'PASS') return 'DECISION_AND_CONSTRAINT';
  return input.relationships.some(r => ['DIRECT','COMPOUND'].includes(r.endpointFitness)) ? 'EVIDENCE_AND_POSITIONING' : 'EXPLORATORY_BRIEF';
}
export function NarrativePatternSelector(input: CanonicalNarrativeInput): NarrativePattern {
  const family = NarrativeBlueprintSelector(input);
  const options = ['fact-first','comparison-first','consequence-first','observation-first'];
  const skeleton = options.sort((a,b) => digest([input.identity,input.knowledge.id,a]).localeCompare(digest([input.identity,input.knowledge.id,b])))[0];
  return { id: `${family}:${skeleton}`, family, skeleton, editorialPurpose: family };
}
export function NarrativeCoherencePass(insights: NarrativeInsight[]): NarrativeInsight[] {
  const seen = new Set<string>();
  return [...insights].sort((a,b) => b.importance-a.importance || a.id.localeCompare(b.id)).filter(i => {
    const key = i.text.toLowerCase().replace(/\s+/g,' ').trim(); if (seen.has(key)) return false; seen.add(key); return true;
  });
}
const titles: Record<string,string> = { THESIS:'Executive brief', ATTENTION:'Why now / strategic context', MANDATE:'What success requires', ADVANTAGE:'Why this reached your desk', RISK:'Principal risk', CAREER_VALUE:'Career value', POSITIONING:'How to win', SENSITIVITY:'What could change the decision', VERIFY:'What to verify', ACTION:'Next action' };
export class DeterministicNarrativeRealizer implements NarrativeRealizer {
  async realize(input: CanonicalNarrativeInput, insights: NarrativeInsight[], pattern: NarrativePattern): Promise<CanonicalNarrativePresentation> {
    const known = new Set(input.knowledge.claims.map(c => c.id)); const relations = new Set(input.relationships.map(r => r.id));
    for (const i of insights) if (i.claimIds.some(id => !known.has(id)) || i.relationshipIds.some(id => !relations.has(id))) throw new Error('Unresolved narrative provenance');
    const selected = NarrativeCoherencePass(insights);
    const blocks = Object.entries(titles).flatMap(([purpose,title]) => {
      const items = selected.filter(i => i.purpose === purpose).slice(0, purpose === 'MANDATE' ? 6 : 2);
      if (!items.length) return [];
      return [{ id: digest([purpose,items.map(i => i.id)]), kind: purpose, title, sentences: items.map(i => ({ text:i.text, insightIds:[i.id], claimIds:i.claimIds, relationshipIds:i.relationshipIds, epistemicState:i.interpretation })) }];
    });
    return { version:'canonical-narrative-shadow/v1', inputHash:digest(input), identity:input.identity, evaluation:input.evaluation, pattern, blueprint:NarrativeBlueprintSelector(input), blocks };
  }
}
export async function narrate(input: CanonicalNarrativeInput, realizer: NarrativeRealizer = new DeterministicNarrativeRealizer()): Promise<CanonicalNarrativePresentation> {
  const context = narrativeContext(input);
  return realizer.realize(input, narrativeSynthesizers.flatMap(fn => fn(context)), NarrativePatternSelector(input));
}
