import { insight, type NarrativeContext } from './NarrativeContextBuilder';
import type { NarrativeInsight } from './types';
const quote = (text: string | undefined) => `“${text ?? ''}”`;

export function ExecutiveThesisSynthesizer(c: NarrativeContext): NarrativeInsight[] {
  const primary = c.work[0] ?? c.qualifications[0] ?? c.company[0];
  if (!primary) return [];
  const roleEvidence = primary.subject.type === 'ROLE';
  return [insight('THESIS', `${c.input.company}: ${roleEvidence ? 'the clearest stated expectation is' : 'the available company context is'} ${quote(primary.displayText)}. ${c.input.evaluation.verdict ? `RADAR records ${c.input.evaluation.verdict}; the evidence below sets out what can inform that decision.` : 'Candidate fit has not been evaluated.'}`, [primary.id], 100)];
}
export function StrategicAttentionSynthesizer(c: NarrativeContext): NarrativeInsight[] {
  return c.company.slice(0, 2).map(claim => insight('ATTENTION', claim.displayText ?? '', [claim.id], 85, claim.epistemicState));
}
export function RoleMandateSynthesizer(c: NarrativeContext): NarrativeInsight[] {
  return [...c.work, ...c.qualifications].map(claim => insight('MANDATE', claim.displayText ?? '', [claim.id], claim.predicate === 'role.outcome' ? 85 : 70, claim.epistemicState));
}
export function CandidateAdvantageSynthesizer(c: NarrativeContext): NarrativeInsight[] {
  return c.relationships.map(r => {
    const candidate = c.byId.get(r.candidateClaimIds[0])!; const job = c.byId.get(r.jobClaimIds[0])!;
    return insight('ADVANTAGE', `RADAR's evaluation links ${quote(candidate.displayText)} with ${quote(job.displayText)} through ${r.candidateCapabilityKey} → ${r.jobCapabilityKey} (${r.relationship.toLowerCase()}). This is a capability relationship; its scope should be read against the actual evidence.`, [candidate.id, job.id], 90, 'SYNTHESIZED', [r.id]);
  });
}
export function PrincipalRiskSynthesizer(c: NarrativeContext): NarrativeInsight[] {
  const conflicts = c.input.knowledge.edges.filter(e => e.relation === 'CONTRADICTS');
  return conflicts.map(e => insight('RISK', `Sources disagree: ${quote(c.byId.get(e.from)?.displayText)} versus ${quote(c.byId.get(e.to)?.displayText)}. Resolve this before relying on either account.`, [e.from,e.to], 95));
}
export function CareerValueSynthesizer(c: NarrativeContext): NarrativeInsight[] {
  const scope = c.claims.find(x => x.predicate === 'role.context');
  if (!scope) return [];
  return [insight('CAREER_VALUE', `The stated structure—${quote(scope.displayText)}—is relevant to how visible and accountable the role could be. Its value to your next move depends on the decisions and resources that accompany that structure.`, [scope.id], 60, 'INFERRED')];
}
export function PursuitStrategySynthesizer(c: NarrativeContext): NarrativeInsight[] {
  if (c.input.evaluation.verdict === 'PASS') return [];
  return c.relationships.filter(r => r.relationship === 'MATCH').map(r => {
    const candidate = c.byId.get(r.candidateClaimIds[0])!; const job = c.byId.get(r.jobClaimIds[0])!;
    return insight('POSITIONING', `For ${quote(job.displayText)}, use the evaluator-linked evidence ${quote(candidate.displayText)}. Prepare the specific decision you owned, the measured result, and the limits of that responsibility; make those boundaries explicit when discussing ${r.jobCapabilityKey}.`, [job.id,candidate.id], 82, 'INFERRED', [r.id]);
  });
}
export function DecisionSensitivitySynthesizer(c: NarrativeContext): NarrativeInsight[] {
  return c.claims.filter(x => x.predicate === 'evaluation.constraint').map(x => insight('SENSITIVITY', `The evaluation records ${quote(x.displayText)} as a constraint. Ask what evidence would resolve it before committing further application effort.`, [x.id], 88, 'INFERRED'));
}
export function VerificationSynthesizer(c: NarrativeContext): NarrativeInsight[] {
  return c.claims.filter(x => x.epistemicState === 'ASSUMED').map(x => insight('VERIFY', `Working hypothesis: ${x.displayText}. What would confirm or contradict this interpretation?`, [x.id], 65, 'ASSUMED'));
}
export function ActionSynthesizer(c: NarrativeContext): NarrativeInsight[] {
  const decision = c.claims.find(x => x.predicate === 'evaluation.verdict');
  const primary = c.work[0] ?? c.qualifications[0];
  if (c.input.evaluation.verdict === 'PASS' && decision) return [insight('ACTION', 'Keep this outside the active application queue under the recorded PASS recommendation.', [decision.id], 90)];
  if (!primary) return [insight('ACTION', 'Request the full operating brief before investing in application preparation.', decision ? [decision.id] : [], 80, 'ASSUMED')];
  return [insight('ACTION', `Use the first contact to establish the employer's immediate priority within ${quote(primary.displayText)}${c.relationships.length ? ', then prepare the linked evidence for that discussion.' : '; candidate-specific positioning remains unresolved.'}`, [primary.id, ...(decision ? [decision.id] : [])], 80, 'INFERRED')];
}
export const narrativeSynthesizers = [ExecutiveThesisSynthesizer, StrategicAttentionSynthesizer, RoleMandateSynthesizer, CandidateAdvantageSynthesizer, PrincipalRiskSynthesizer, CareerValueSynthesizer, PursuitStrategySynthesizer, DecisionSensitivitySynthesizer, VerificationSynthesizer, ActionSynthesizer];
