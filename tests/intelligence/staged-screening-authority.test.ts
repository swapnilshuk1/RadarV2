import { describe, expect, it } from 'vitest';

import { contextFields, scopeFields, type EvidenceSource, type Research } from '../../src/dossier/contracts';
import { validateResearch } from '../../src/dossier/grounding';

const jdSource: EvidenceSource = {
  id: 'JD-SOURCE',
  plane: 'JD',
  title: 'Role',
  locator: 'fixture://role',
  text: 'MANDATORY CRITERIA\nDemonstrable experience leading a sales team of 5+ with direct ownership of targets, reviews, incentives, and outcomes.',
  capturedAt: '2026-09-16T00:00:00.000Z',
  attribution: 'JOB_POST',
};

const openResolutions = [...contextFields, ...scopeFields].map(field => ({
  field,
  status: 'OPEN' as const,
  value: null,
  claimIds: [],
  methods: ['ask' as const],
  question: `What is ${field}?`,
  consequence: `${field} may change the decision context.`,
}));

const research = (): Research => ({
  claims: [{
    id: 'JD-1',
    text: 'Demonstrable experience leading a sales team of 5+ with direct ownership of targets, reviews, incentives, and outcomes',
    state: 'EXPLICIT',
    confidence: 1,
    plane: 'JD',
    citations: [{
      sourceId: jdSource.id,
      quote: 'MANDATORY CRITERIA\nDemonstrable experience leading a sales team of 5+ with direct ownership of targets, reviews, incentives, and outcomes.',
    }],
    derivedFrom: [],
  }],
  resolutions: openResolutions,
  candidateConflicts: [],
  evaluation: {
    verdict: 'PASS',
    screeningViability: 'BLOCKED',
    rationale: 'The supplied candidate sources do not evidence the mandatory sales-team leadership qualification.',
    claimIds: ['JD-1'],
    requirements: [{
      requirement: 'Demonstrable experience leading a sales team of 5+ with direct ownership of targets, reviews, incentives, and outcomes',
      mandatory: true,
      decisionRole: 'HARD_SCREEN',
      status: 'NOT_EVIDENCED',
      roleClaimIds: ['JD-1'],
      candidateClaimIds: [],
      reasoning: 'The supplied candidate sources do not evidence this mandatory qualification.',
    }],
  },
  narrativePlan: {
    roleArchetype: 'Sales leader',
    mandateShape: 'Build and lead a target-carrying sales team',
    careerMove: 'Domain-specific sales leadership move',
    authorityShape: 'People leadership with target ownership',
    fitShape: 'Screening evidence is incomplete',
    evidenceShape: 'Grounded in the supplied JD',
    decisionTension: 'A mandatory employer doorway is not evidenced in the supplied candidate sources',
    companyTrajectory: 'Unresolved',
    argument: 'The supplied candidate sources do not evidence the mandatory employer-entry qualification, so normal pursuit capital is not justified.',
    emphasis: ['screening accessibility'],
    sectionOrder: ['executiveThesis', 'fit', 'recommendation'],
    claimIds: ['JD-1'],
  },
});

describe('staged screening authority bridge', () => {
  it('keeps the legacy lexical hard-screen rail as the default', () => {
    expect(() => validateResearch(research(), [jdSource])).toThrow(/needs an explicit employer entry qualification/);
  });

  it('accepts application-assembled hard screens after exact-source semantic adjudication', () => {
    const validated = validateResearch(research(), [jdSource], { hardScreenAuthority: 'PREVALIDATED' });
    expect(validated.evaluation.requirements[0].decisionRole).toBe('HARD_SCREEN');
    expect(validated.evaluation.screeningViability).toBe('BLOCKED');
    expect(validated.evaluation.verdict).toBe('PASS');
  });
});
