import { describe, expect, it } from 'vitest';
import type { Claim } from '../../src/dossier/contracts';
import {
  mappingFixtures,
  scoreMappingFixture,
  scoreScreeningFixture,
  screeningFixtures,
  validateMappingSeamResponse,
  validateScreeningSeamResponse,
} from '../../src/dossier/semantic-seam-benchmark';

const candidateClaim = (id: string): Claim => ({
  id,
  text: 'Evidence',
  state: 'EXPLICIT',
  confidence: 1,
  plane: 'CANDIDATE',
  citations: [],
  derivedFrom: [],
});

describe('semantic seam benchmark', () => {
  it('freezes a compact cross-case benchmark instead of rerunning full Research', () => {
    expect(screeningFixtures).toHaveLength(12);
    expect(mappingFixtures).toHaveLength(6);
    expect(new Set(screeningFixtures.map(item => item.id)).size).toBe(screeningFixtures.length);
    expect(new Set(mappingFixtures.map(item => item.id)).size).toBe(mappingFixtures.length);
    expect(new Set(screeningFixtures.map(item => item.caseKey))).toEqual(new Set(['schnell', 'artificilux', '2070']));
    expect(new Set(mappingFixtures.map(item => item.caseKey))).toEqual(new Set(['schnell', 'artificilux', '2070']));
  });

  it('scores screening against the precommitted gate expectation', () => {
    const fixture = screeningFixtures.find(item => item.id === 'artificilux-relevant-experience')!;
    const response = validateScreeningSeamResponse({ screeningGate: true, reasoning: 'Explicit experience qualification.' });
    expect(scoreScreeningFixture(fixture, response).passed).toBe(true);
    expect(scoreScreeningFixture(fixture, { ...response, screeningGate: false }).passed).toBe(false);
  });

  it('rejects malformed candidate references and evidence-free positive mappings', () => {
    expect(() => validateMappingSeamResponse({
      status: 'ADJACENT',
      candidateClaimIds: [],
      unsupportedAspects: ['Missing domain evidence'],
      reasoning: 'Related but not proven.',
    }, [candidateClaim('C-1')])).toThrow('Positive fit mapping needs candidate proof');

    expect(() => validateMappingSeamResponse({
      status: 'ADJACENT',
      candidateClaimIds: ['C-404'],
      unsupportedAspects: ['Missing domain evidence'],
      reasoning: 'Related but not proven.',
    }, [candidateClaim('C-1')])).toThrow('Unknown candidate mapping claim reference');
  });

  it('does not permit DIRECT while material aspects remain unsupported', () => {
    expect(() => validateMappingSeamResponse({
      status: 'DIRECT',
      candidateClaimIds: ['C-1'],
      unsupportedAspects: ['UX/product design'],
      reasoning: 'Brand evidence only.',
    }, [candidateClaim('C-1')])).toThrow('Direct fit mapping cannot contain unsupported requirement aspects');
  });

  it('keeps absence distinct from contradiction', () => {
    expect(() => validateMappingSeamResponse({
      status: 'CONTRADICTED',
      candidateClaimIds: [],
      unsupportedAspects: ['No portfolio supplied'],
      reasoning: 'Absent evidence.',
    }, [candidateClaim('C-1')])).toThrow('affirmative candidate evidence');

    expect(validateMappingSeamResponse({
      status: 'NOT_EVIDENCED',
      candidateClaimIds: [],
      unsupportedAspects: ['No portfolio supplied'],
      reasoning: 'Absent evidence.',
    }, [candidateClaim('C-1')]).status).toBe('NOT_EVIDENCED');
  });

  it('scores the known mapping traps without overconstraining adjacent versus transferable judgment', () => {
    const mandate = mappingFixtures.find(item => item.id === 'schnell-exclusive-mandates')!;
    const adjacent = validateMappingSeamResponse({
      status: 'ADJACENT',
      candidateClaimIds: ['C-1'],
      unsupportedAspects: ['Property-sales mandate experience'],
      reasoning: 'Agency mandate precedent is related but not the same thing.',
    }, [candidateClaim('C-1')]);
    expect(scoreMappingFixture(mandate, adjacent).passed).toBe(true);

    const wrongDirect = {
      status: 'DIRECT' as const,
      candidateClaimIds: ['C-1'],
      unsupportedAspects: [],
      reasoning: 'Treats agency mandate as property mandate.',
    };
    expect(scoreMappingFixture(mandate, wrongDirect).passed).toBe(false);
  });

  it('requires unsupported aspects for the composite 2070 traps', () => {
    const fixture = mappingFixtures.find(item => item.id === '2070-dual-domain-10y')!;
    const response = validateMappingSeamResponse({
      status: 'ADJACENT',
      candidateClaimIds: ['C-1'],
      unsupportedAspects: [],
      reasoning: 'Brand precedent but no UX evidence.',
    }, [candidateClaim('C-1')]);
    expect(scoreMappingFixture(fixture, response).passed).toBe(false);
  });
});
