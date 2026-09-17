import { describe, expect, it } from 'vitest';

import { contextFields, scopeFields, type Claim, type EvidenceSource, type ReasoningModel } from '../../src/dossier/contracts';
import { runStagedFrozenDecisionDetailed } from '../../src/dossier/staged-decision';
import { validateScreening } from '../../src/dossier/staged-decision';
import {
  materializeStagedScreeningAdjudication,
  screeningConstraintForDrivers,
  stagedCareerCapitalSchema,
  stagedDecisionProposalSchema,
  validateStagedCareerCapital,
  validateStagedDecisionModel,
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
}));

const noCareerCapital = {
  authority: { material: false, candidateClaimIds: [], operatingConditionIds: [], resolutionFields: [] },
  scope: { material: false, candidateClaimIds: [], operatingConditionIds: [], resolutionFields: [] },
  functionalAltitude: { material: false, candidateClaimIds: [], operatingConditionIds: [], resolutionFields: [] },
  compensation: { material: false, candidateClaimIds: [], operatingConditionIds: [], resolutionFields: [] },
};

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
        ? { screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE', reasoning: 'The exact JD says candidates must have the prior experience.' }
        : { screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE', reasoning: 'The exact JD marks this preferred and not mandatory.' };
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
    if (instruction.includes('career-capital adjudicator')) return noCareerCapital;
    if (instruction.includes('executive decision reasoner')) {
      return {
        screeningViability: 'BLOCKED',
        verdict: 'PASS',
        decisionHinges: [{
          requirementIds: ['REQ-001'],
          resolutionFields: [],
        }],
        reopeningConditions: [{
          requirementIds: ['REQ-001'],
        }],
      };
    }
    throw new Error('Unexpected staged decision instruction');
  }
}

class ResolvedQuestionModel extends ScriptedModel {
  override readonly id = 'resolved-question-model';
  override async generate(instruction: string, input: any): Promise<unknown> {
    const result = await super.generate(instruction, input);
    if (instruction.startsWith('Resolve only RADAR')) {
      return {
        resolutions: [
          {
            field: contextFields[0], status: 'RESOLVED', value: 'Known value',
            claimIds: ['JD-1'], methods: ['extract'],
            question: 'A resolved field must not retain a question.',
          },
          ...openResolutions.slice(1),
        ],
      };
    }
    return result;
  }
}

class ResolvedLeadershipModeModel extends ScriptedModel {
  override readonly id = 'resolved-leadership-mode-model';
  override async generate(instruction: string, input: any): Promise<unknown> {
    const result = await super.generate(instruction, input);
    if (instruction.startsWith('Resolve only RADAR')) {
      return {
        resolutions: [
          ...openResolutions.filter(resolution => resolution.field !== 'leadershipMode'),
          {
            field: 'leadershipMode', status: 'RESOLVED', value: 'INDIVIDUAL_CONTRIBUTOR_HANDS_ON_LEAD',
            claimIds: ['JD-1'], methods: ['infer'],
          },
        ],
      };
    }
    return result;
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
  screeningFunction: 'ENTRY_QUALIFICATION',
  screeningGateBasis: 'PRIOR_RELEVANT_EXPERIENCE',
  screeningReasoning: 'Explicit entry qualification.',
  status: 'NOT_EVIDENCED',
  candidateClaimIds: [],
  unsupportedAspects: ['Relevant Operations experience'],
  mappingReasoning: 'Not evidenced.',
});

describe('staged production decision boundary', () => {
  it('derives screening gates only from an explicit entry-selection function', () => {
    const required = {
      id: 'REQ-001', requirement: 'Data analysis capability', strength: 'REQUIRED' as const,
      roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Important for delivery.',
    };
    expect(materializeStagedScreeningAdjudication({
      screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'NONE', reasoning: 'Required to perform the role.',
    }, required).screeningGate).toBe(false);
    expect(materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE', reasoning: 'Candidates must bring prior relevant experience.',
    }, required).screeningGate).toBe(true);
  });

  it('rejects internally inconsistent screening adjudications', () => {
    const required = {
      id: 'REQ-001', requirement: 'Relevant experience', strength: 'REQUIRED' as const,
      roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Role requirement.',
    };
    expect(() => materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'NONE', reasoning: 'Incomplete.',
    }, required)).toThrow('entry qualification needs a stated gate basis');
    expect(() => materializeStagedScreeningAdjudication({
      screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT', gateBasis: 'MANDATORY_CREDENTIAL', reasoning: 'Inconsistent.',
    }, required)).toThrow('role-performance requirement cannot carry an entry gate basis');
    expect(() => materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE', reasoning: 'Inconsistent preference.',
    }, { ...required, strength: 'PREFERRED' })).toThrow('preferred requirement cannot become an entry qualification');
  });
  it('requires an entry basis to be supported by local exact JD qualification wording', () => {
    const required = {
      id: 'REQ-001', requirement: 'Data-driven growth tools', strength: 'REQUIRED' as const,
      roleImportance: 'ENABLER' as const, roleClaimIds: ['JD-1'], reasoning: 'Useful for delivery.',
    };
    expect(() => validateScreening({
      screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE', reasoning: 'The tool proficiency is required.',
    }, required, ['Proficiency in data-driven growth tools including Google Sheets and Tableau.']))
      .toThrow('not supported by the cited JD evidence');
    expect(validateScreening({
      screeningFunction: 'ENTRY_QUALIFICATION', gateBasis: 'PRIOR_RELEVANT_EXPERIENCE', reasoning: 'The employer requires relevant prior experience.',
    }, required, ['Candidates must have relevant experience in operations.']).screeningGate).toBe(true);
  });
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

  it('materializes every unresolved screening gate as an application-owned driver', () => {
    const role = materializeStagedRoleAnalysis({
      requirements: [{
        requirement: 'Relevant experience in Operations', strength: 'REQUIRED', roleImportance: 'CORE_CAPABILITY',
        roleClaimIds: ['JD-1'], reasoning: 'Required experience.',
      }],
      operatingConditions: [], authorityShape: 'Operating leader', roleSideConditions: [],
    }, claims.filter(claim => claim.plane === 'JD'));
    const first = baseMapped();
    const second: StagedMappedRequirement = {
      ...baseMapped(), id: 'REQ-002', status: 'ADJACENT', candidateClaimIds: ['CANDIDATE-1'],
    };
    const drivers: StagedScreeningDriver[] = [
      { ...first, gapNature: 'MISSING_EXPERIENCE', gapReasoning: 'Substantive prior experience is missing.' },
      { ...second, gapNature: 'PARTIAL_EVIDENCE', gapReasoning: 'Adjacent proof remains partial.' },
    ];

    const decision = validateStagedDecisionModel({
      screeningViability: 'BLOCKED', verdict: 'PASS',
      decisionHinges: [{ requirementIds: ['REQ-001'], resolutionFields: [] }],
      reopeningConditions: [{ requirementIds: ['REQ-001'] }],
    }, [first, second], drivers, role, [], noCareerCapital);

    expect(decision.screeningDriverRequirementIds).toEqual(['REQ-001', 'REQ-002']);
  });

  it('requires every career-capital axis to be either supported or empty', () => {
    const role = materializeStagedRoleAnalysis({
      requirements: [{
        requirement: 'Relevant experience in Operations', strength: 'REQUIRED', roleImportance: 'CORE_CAPABILITY',
        roleClaimIds: ['JD-1'], reasoning: 'Required experience.',
      }],
      operatingConditions: [{
        condition: 'Hands-on role', kind: 'AUTHORITY_SHAPE', roleClaimIds: ['JD-1'], reasoning: 'Role shape.',
      }],
      authorityShape: 'Hands-on operating leader', roleSideConditions: [],
    }, claims.filter(claim => claim.plane === 'JD'));
    const candidateClaims = claims.filter(claim => claim.plane === 'CANDIDATE');

    expect(() => validateStagedCareerCapital({
      ...noCareerCapital,
      authority: { ...noCareerCapital.authority, candidateClaimIds: ['CANDIDATE-1'] },
    }, role, [], candidateClaims)).toThrow('Non-material authority career-capital axis cannot carry supporting references');

    expect(() => validateStagedCareerCapital({
      ...noCareerCapital,
      authority: { material: true, candidateClaimIds: [], operatingConditionIds: [], resolutionFields: [] },
    }, role, [], candidateClaims)).toThrow('Material authority career-capital axis needs immutable supporting references');

    expect(stagedCareerCapitalSchema.parse({
      ...noCareerCapital,
      authority: { material: true, candidateClaimIds: ['CANDIDATE-1'], operatingConditionIds: ['OP-001'], resolutionFields: [] },
    }).authority.material).toBe(true);
  });

  it('excludes narrative-plan and prose fields from the strict decision proposal', () => {
    expect(() => stagedDecisionProposalSchema.parse({
      screeningViability: 'BLOCKED',
      verdict: 'PASS',
      decisionHinges: [{ requirementIds: ['REQ-001'], resolutionFields: [] }],
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
    expect(result.decision.careerCapital).toEqual(noCareerCapital);
    expect(result.decision.decisionHinges[0]).not.toHaveProperty('statement');
  });

  it('rejects a question on a resolved field before decision reasoning', async () => {
    await expect(runStagedFrozenDecisionDetailed(frozen, new ResolvedQuestionModel()))
      .rejects.toThrow(`Resolved field cannot carry a question: ${contextFields[0]}`);
  });

  it('requires analytical leadership mode classifications to be inferred', async () => {
    await expect(runStagedFrozenDecisionDetailed(frozen, new ResolvedLeadershipModeModel()))
      .rejects.toThrow('leadershipMode is an analytical classification; label it INFERRED unless the source uses the classification itself');
  });
});
