import { describe, expect, it } from 'vitest';

import { contextFields, scopeFields, type Claim, type EvidenceSource, type ReasoningModel } from '../../src/dossier/contracts';
import { runStagedFrozenDecisionDetailed } from '../../src/dossier/staged-decision';
import {
  screeningConstraintForDrivers,
  stagedDecisionModelSchema,
  type StagedScreeningDriver,
} from '../../src/dossier/staged-decision-contract';
import {
  eligibleScreeningDrivers,
  materializeStagedRoleAnalysis,
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

class ScriptedModel implements ReasoningModel {
  readonly id = 'test-model';
  readonly version = '1';

  async generate(instruction: string, input: any): Promise<unknown> {
    const actual = input?.input ?? input;
    if (instruction.includes('role interpreter')) {
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
    if (instruction.includes('screening-gap classifier')) {
      return { gapNature: 'MISSING_EXPERIENCE', reasoning: 'The unresolved gate is substantive prior experience, not a missing proof artifact.' };
    }
    if (instruction.includes('executive decision reasoner')) {
      return {
        screeningViability: 'BLOCKED',
        verdict: 'PASS',
        screeningDriverRequirementIds: ['REQ-001'],
        careerCapitalTrade: {
          material: false,
          dimension: 'NONE',
          statement: 'No distinct career-capital trade is established by this fixture.',
          candidateClaimIds: [],
          operatingConditionIds: [],
          resolutionFields: [],
        },
        decisionHinges: [{
          statement: 'New verified Operations experience would change employer accessibility.',
          requirementIds: ['REQ-001'],
          resolutionFields: [],
        }],
        reopeningConditions: [{
          statement: 'Reopen only if verifiable relevant Operations experience is supplied.',
          requirementIds: ['REQ-001'],
        }],
      };
    }
    throw new Error('Unexpected staged decision instruction');
  }
}

const baseMapped = (): StagedMappedRequirement => ({
  id: 'REQ-001',
  requirement: 'Relevant experience in Operations',
  strength: 'REQUIRED',
  roleImportance: 'CORE_CAPABILITY',
  roleClaimIds: ['JD-1'],
  reasoning: 'Required experience.',
  screeningGate: true,
  screeningReasoning: 'Explicit entry qualification.',
  status: 'NOT_EVIDENCED',
  candidateClaimIds: [],
  unsupportedAspects: ['Relevant Operations experience'],
  mappingReasoning: 'Not evidenced.',
});

describe('staged production decision boundary', () => {
  it('keeps application-owned identities and screening-driver admissibility', () => {
    const role = materializeStagedRoleAnalysis({
      requirements: [{ requirement: 'Relevant experience in Operations', strength: 'REQUIRED', roleImportance: 'CORE_CAPABILITY', roleClaimIds: ['JD-1'], reasoning: 'Required experience.' }],
      operatingConditions: [{ condition: 'Hands-on role', kind: 'OPERATING_SHAPE', roleClaimIds: ['JD-1'], reasoning: 'Operating shape.' }],
      authorityShape: 'Hands-on operating leader',
      roleSideConditions: [],
    }, claims.filter(claim => claim.plane === 'JD'));

    expect(role.requirements[0].id).toBe('REQ-001');
    expect(role.operatingConditions[0].id).toBe('OP-001');

    const base = baseMapped();
    const rows: StagedMappedRequirement[] = [
      { ...base, status: 'DIRECT', unsupportedAspects: [] },
      { ...base, id: 'REQ-002', status: 'ADJACENT', candidateClaimIds: ['CANDIDATE-1'] },
      { ...base, id: 'REQ-003', screeningGate: false, status: 'NOT_EVIDENCED' },
    ];
    expect(eligibleScreeningDrivers(rows).map(row => row.id)).toEqual(['REQ-002']);
  });

  it('binds missing experience/conflict to BLOCKED and missing artifact/partial proof to at most FRAGILE', () => {
    const base = baseMapped();
    const missingExperience: StagedScreeningDriver = {
      ...base,
      gapNature: 'MISSING_EXPERIENCE',
      gapReasoning: 'Substantive prior experience is not established.',
    };
    const missingArtifact: StagedScreeningDriver = {
      ...base,
      gapNature: 'MISSING_ARTIFACT',
      gapReasoning: 'A required proof object is not supplied.',
    };

    expect(screeningConstraintForDrivers([missingExperience])).toBe('BLOCKED_REQUIRED');
    expect(screeningConstraintForDrivers([missingArtifact])).toBe('MAX_FRAGILE');
    expect(screeningConstraintForDrivers([])).toBe('NONE');
  });

  it('excludes narrative-plan/editorial fields from the strict decision contract', () => {
    expect(() => stagedDecisionModelSchema.parse({
      screeningViability: 'BLOCKED',
      verdict: 'PASS',
      screeningDriverRequirementIds: ['REQ-001'],
      careerCapitalTrade: {
        material: false,
        dimension: 'NONE',
        statement: 'No material trade.',
        candidateClaimIds: [],
        operatingConditionIds: [],
        resolutionFields: [],
      },
      decisionHinges: [{ statement: 'Evidence changes access.', requirementIds: ['REQ-001'], resolutionFields: [] }],
      reopeningConditions: [],
      narrativePlan: { argument: 'Editorial material does not belong in the decision model.' },
    })).toThrow();
  });

  it('returns a validated compact decision without assembling canonical Research', async () => {
    const result = await runStagedFrozenDecisionDetailed(frozen, new ScriptedModel());

    expect(result.decision).toMatchObject({
      verdict: 'PASS',
      screeningViability: 'BLOCKED',
      screeningDriverRequirementIds: ['REQ-001'],
    });
    expect(result.trace.screeningConstraint).toBe('BLOCKED_REQUIRED');
    expect(result.trace.eligibleScreeningDrivers[0].gapNature).toBe('MISSING_EXPERIENCE');
    expect(result).not.toHaveProperty('research');
    expect(result.decision).not.toHaveProperty('narrativePlan');
  });
});
