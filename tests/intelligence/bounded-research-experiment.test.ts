import { describe, expect, it } from 'vitest';
import { validateCandidateMapping, validateRoleAnalyticalCore } from '../../src/dossier/bounded-research-experiment';
import type { Claim, EvidenceSource } from '../../src/dossier/contracts';

const source: EvidenceSource = { id: 'jd', plane: 'JD', title: 'Role', locator: 'test', text: 'Candidates need a portfolio. This is an individual contributor role.', capturedAt: '2026-01-01T00:00:00.000Z', attribution: 'JOB_POST' };
const claim = (id: string, text: string): Claim => ({ id, text, state: 'EXPLICIT', confidence: 1, plane: 'JD', citations: [{ sourceId: 'jd', quote: text }], derivedFrom: [] });
const candidate = (id: string): Claim => ({ id, text: 'Led a 40-person team.', state: 'EXPLICIT', confidence: 1, plane: 'CANDIDATE', citations: [{ sourceId: 'cv', quote: 'Led a 40-person team.' }], derivedFrom: [] });

describe('bounded research experiment contracts', () => {
  it('keeps a role operating condition out of candidate requirements', () => {
    const roleClaims = [claim('JD-1', 'Candidates need a portfolio.'), claim('JD-2', 'This is an individual contributor role.')];
    expect(() => validateRoleAnalyticalCore({ requirements: [{ id: 'portfolio', requirement: 'Portfolio', mandatory: true, decisionRole: 'HARD_SCREEN', roleClaimIds: ['JD-1'], reasoning: 'Explicit entry qualification.' }], operatingConditions: [{ id: 'ic', condition: 'Craft-led IC', kind: 'OPERATING_SHAPE', roleClaimIds: ['JD-2'], reasoning: 'Role shape.' }], authorityShape: 'Craft-led', roleSideConditions: [] }, roleClaims, [source])).not.toThrow();
    expect(() => validateRoleAnalyticalCore({ requirements: [{ id: 'ic', requirement: 'IC role', mandatory: true, decisionRole: 'HARD_SCREEN', roleClaimIds: ['JD-2'], reasoning: 'Wrong.' }], operatingConditions: [], authorityShape: 'Craft-led', roleSideConditions: [] }, roleClaims, [source])).toThrow('explicit employer entry qualification');
  });
  it('maps each immutable requirement exactly once without evaluating operating shape', () => {
    const role = { requirements: [{ id: 'portfolio', requirement: 'Portfolio', mandatory: true, decisionRole: 'HARD_SCREEN' as const, roleClaimIds: ['JD-1'], reasoning: 'Required.' }], operatingConditions: [{ id: 'ic', condition: 'IC', kind: 'OPERATING_SHAPE' as const, roleClaimIds: ['JD-2'], reasoning: 'Shape.' }], authorityShape: 'Craft-led', roleSideConditions: [] };
    expect(() => validateCandidateMapping({ mappings: [{ requirementId: 'portfolio', status: 'NOT_EVIDENCED', candidateClaimIds: [], reasoning: 'No supplied portfolio.' }], authorityFacts: [{ claimIds: ['C-1'], observation: 'Team leadership is authority context.' }] }, role, [candidate('C-1')])).not.toThrow();
  });
});