import { describe, expect, it } from 'vitest';

import { contextFields, scopeFields, type Claim, type EvidenceSource, type ReasoningModel } from '../../src/dossier/contracts';
import {
  assembleStagedResearch,
  eligibleScreeningDrivers,
  materializeStagedRoleAnalysis,
  runStagedFrozenResearchDetailed,
  type StagedMappedRequirement,
  type StagedResearchInput,
} from '../../src/dossier/staged-research';

const jdSource: EvidenceSource = {
  id: 'JD-SOURCE',
  plane: 'JD',
  title: 'Role',
  locator: 'fixture://role',
  text: 'Candidates must have relevant experience in Operations. Hindi is preferred, not mandatory.',
  capturedAt: '2026-09-16T00:00:00.000Z',
  attribution: 'JOB_POST',
};
const candidateSource: EvidenceSource = {
  id: 'CANDIDATE-SOURCE',
  plane: 'CANDIDATE',
  title: 'CV',
  locator: 'fixture://cv',
  text: 'Led a 40-person team.',
  capturedAt: '2026-09-16T00:00:00.000Z',
  attribution: 'CANDIDATE_SUPPLIED',
};
const claims: Claim[] = [
  {
    id: 'JD-1', text: 'Relevant operations experience is required', state: 'EXPLICIT', confidence: 1, plane: 'JD',
    citations: [{ sourceId: 'JD-SOURCE', quote: 'Candidates must have relevant experience in Operations.' }], derivedFrom: [],
  },
  {
    id: 'JD-2', text: 'Hindi is preferred', state: 'EXPLICIT', confidence: 1, plane: 'JD',
    citations: [{ sourceId: 'JD-SOURCE', quote: 'Hindi is preferred, not mandatory.' }], derivedFrom: [],
  },
  {
    id: 'CANDIDATE-1', text: 'Led a 40-person team', state: 'EXPLICIT', confidence: 1, plane: 'CANDIDATE',
    citations: [{ sourceId: 'CANDIDATE-SOURCE', quote: 'Led a 40-person team.' }], derivedFrom: [],
  },
];

const frozen: StagedResearchInput = {
  opportunity: { id: 'opp-1', company: 'ExampleCo', title: 'Head of Operations' },
  candidate: { name: 'Candidate' },
  sources: [jdSource, candidateSource],
  evidence: claims,
  candidateSourceRefs: [{ id: candidateSource.id, title: candidateSource.title }],
  candidateConflicts: [],
  acquisition: [],
  validEvidenceClaimIds: claims.map(claim => claim.id),
  fields: [...contextFields, ...scopeFields],
  fingerprint: 'fixture',
};

const openResolutions = [...contextFields, ...scopeFields].map(field => ({
  field,
  status: 'OPEN' as const,
  value: null,
  claimIds: [],
  methods: ['ask' as const],
  question: `What is ${field}?`,
  consequence: `${field} can change the decision context.`,
}));

const narrativePlan = {
  roleArchetype: 'Operating leader',
  mandateShape: 'Build and run operations',
  careerMove: 'A material operating-scope change',
  authorityShape: 'Leadership role',
  fitShape: 'Mixed direct and adjacent evidence',
  evidenceShape: 'Grounded in supplied role and candidate sources',
  decisionTension: 'Entry qualification is not evidenced in the supplied candidate sources',
  companyTrajectory: 'Company trajectory remains unresolved',
  argument: 'The required operations qualification is not evidenced in the supplied candidate sources, so normal pursuit capital is not justified without new proof.',
  emphasis: ['screening accessibility', 'career capital'],
  sectionOrder: ['executiveThesis', 'fit', 'recommendation'],
};

class ScriptedModel implements ReasoningModel {
  readonly id = 'test-model';
  readonly version = '1';

  async generate(instruction: string, input: any): Promise<unknown> {
    const actual = input?.input ?? input;
    if (instruction.includes("role interpreter")) {
      return {
        requirements: [
          { requirement: 'Relevant experience in Operations', strength: 'REQUIRED', roleImportance: 'CORE_CAPABILITY', roleClaimIds: ['JD-1'], reasoning: 'Explicit prior-experience qualification.' },
          { requirement: 'Hindi fluency', strength: 'PREFERRED', roleImportance: 'ENABLER', roleClaimIds: ['JD-2'], reasoning: 'Explicit preference.' },
        ],
        operatingConditions: [],
        authorityShape: 'Operating leadership role',
        roleSideConditions: [],
      };
    }
    if (instruction.includes('screening adjudicator')) {
      return actual.requirement.strength === 'REQUIRED'
        ? { screeningGate: true, reasoning: 'The exact JD says candidates must have the prior experience.' }
        : { screeningGate: false, reasoning: 'The exact JD marks this preferred and not mandatory.' };
    }
    if (instruction.includes('candidate-to-requirement mapper')) {
      return actual.requirement.strength === 'REQUIRED'
        ? { status: 'NOT_EVIDENCED', candidateClaimIds: [], unsupportedAspects: ['Relevant Operations experience'], reasoning: 'Relevant Operations experience is not evidenced in the supplied candidate sources.' }
        : { status: 'NOT_EVIDENCED', candidateClaimIds: [], unsupportedAspects: ['Hindi fluency'], reasoning: 'Hindi fluency is not evidenced in the supplied candidate sources.' };
    }
    if (instruction.startsWith('Resolve only RADAR')) return { resolutions: openResolutions };
    if (instruction.includes('executive decision reasoner')) {
      return { screeningViability: 'BLOCKED', verdict: 'PASS', rationale: 'The explicit operations-entry qualification is not evidenced in the supplied candidate sources.', narrativePlan };
    }
    throw new Error('Unexpected staged instruction');
  }
}

describe('production staged research', () => {
  it('assigns requirement and operating-condition identities in the application', () => {
    const role = materializeStagedRoleAnalysis({
      requirements: [{ requirement: 'Relevant experience in Operations', strength: 'REQUIRED', roleImportance: 'CORE_CAPABILITY', roleClaimIds: ['JD-1'], reasoning: 'Required experience.' }],
      operatingConditions: [{ condition: 'Hands-on role', kind: 'OPERATING_SHAPE', roleClaimIds: ['JD-1'], reasoning: 'Operating shape.' }],
      authorityShape: 'Hands-on operating leader',
      roleSideConditions: [],
    }, claims.filter(claim => claim.plane === 'JD'));
    expect(role.requirements[0].id).toBe('REQ-001');
    expect(role.operatingConditions[0].id).toBe('OP-001');
  });

  it('only admits non-direct screening gates as candidate screening drivers', () => {
    const base = {
      id: 'REQ-001', requirement: 'A', strength: 'REQUIRED' as const, roleImportance: 'CORE_CAPABILITY' as const,
      roleClaimIds: ['JD-1'], reasoning: 'x', screeningFunction: 'ENTRY_QUALIFICATION' as const, screeningGateBasis: 'PRIOR_RELEVANT_EXPERIENCE' as const, screeningReasoning: 'x', candidateClaimIds: [], unsupportedAspects: [], mappingReasoning: 'x',
    };
    const rows: StagedMappedRequirement[] = [
      { ...base, screeningGate: true, status: 'DIRECT' },
      { ...base, id: 'REQ-002', screeningGate: true, status: 'ADJACENT' },
      { ...base, id: 'REQ-003', screeningGate: false, status: 'NOT_EVIDENCED' },
    ];
    expect(eligibleScreeningDrivers(rows).map(row => row.id)).toEqual(['REQ-002']);
  });

  it('assembles the staged result back into the existing canonical Research contract', async () => {
    const result = await runStagedFrozenResearchDetailed(frozen, new ScriptedModel());
    expect(result.research.evaluation.verdict).toBe('PASS');
    expect(result.research.evaluation.screeningViability).toBe('BLOCKED');
    expect(result.research.evaluation.requirements[0].decisionRole).toBe('HARD_SCREEN');
    expect(result.research.evaluation.requirements[1].decisionRole).toBe('PREFERENCE');
    expect(result.trace.eligibleScreeningDrivers.map(item => item.id)).toEqual(['REQ-001']);
    expect(result.research.claims).toEqual(claims);
  });

  it('keeps the canonical assembly independently testable', () => {
    const role = materializeStagedRoleAnalysis({
      requirements: [{ requirement: 'Relevant experience in Operations', strength: 'REQUIRED', roleImportance: 'CORE_CAPABILITY', roleClaimIds: ['JD-1'], reasoning: 'Required experience.' }],
      operatingConditions: [], authorityShape: 'Operating leader', roleSideConditions: [],
    }, claims.filter(claim => claim.plane === 'JD'));
    const mapped: StagedMappedRequirement[] = [{
      ...role.requirements[0], screeningGate: true, screeningFunction: 'ENTRY_QUALIFICATION', screeningGateBasis: 'PRIOR_RELEVANT_EXPERIENCE', screeningReasoning: 'Explicit gate.', status: 'NOT_EVIDENCED', candidateClaimIds: [], unsupportedAspects: ['Operations experience'], mappingReasoning: 'Operations experience is not evidenced in the supplied candidate sources.',
    }];
    const research = assembleStagedResearch(frozen, role, mapped, openResolutions, {
      screeningViability: 'BLOCKED', verdict: 'PASS', rationale: 'The entry qualification is not evidenced in the supplied candidate sources.', narrativePlan,
    });
    expect(research.evaluation.requirements[0]).toMatchObject({ mandatory: true, decisionRole: 'HARD_SCREEN', status: 'NOT_EVIDENCED' });
  });
});
