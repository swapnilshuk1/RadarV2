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
        ? {
            screeningFunction: 'ENTRY_QUALIFICATION',
            gateBasis: 'PRIOR_RELEVANT_EXPERIENCE',
            reasoning: 'The exact JD says candidates must have the prior experience.',
            exactSourceQuote: 'Candidates must have relevant experience in Operations.',
            basisSupport: {
              kind: 'PRIOR_RELEVANT_EXPERIENCE',
              experienceText: 'relevant experience in Operations',
            },
          }
        : {
            screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT',
            gateBasis: 'NONE',
            reasoning: 'The exact JD marks this preferred and not mandatory.',
            exactSourceQuote: 'Hindi is preferred, not mandatory.',
            basisSupport: {
              kind: 'NONE',
            },
          };
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
      screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT',
      gateBasis: 'NONE',
      reasoning: 'Required to perform the role.',
      exactSourceQuote: 'Required to perform the role.',
      basisSupport: { kind: 'NONE' },
    }, required).screeningGate).toBe(false);
    expect(materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'PRIOR_RELEVANT_EXPERIENCE',
      reasoning: 'Candidates must bring prior relevant experience.',
      exactSourceQuote: 'Candidates must bring prior relevant experience.',
      basisSupport: {
        kind: 'PRIOR_RELEVANT_EXPERIENCE',
        experienceText: 'prior relevant experience',
      },
    }, required, ['Candidates must bring prior relevant experience.']).screeningGate).toBe(true);
  });

  it('fails closed when ENTRY_QUALIFICATION has no cited exact JD evidence', () => {
    const required = {
      id: 'REQ-001', requirement: 'Relevant experience', strength: 'REQUIRED' as const,
      roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Role requirement.',
    };
    expect(() => materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'PRIOR_RELEVANT_EXPERIENCE',
      reasoning: 'Candidates must bring prior relevant experience.',
      exactSourceQuote: 'Candidates must bring prior relevant experience.',
      basisSupport: {
        kind: 'PRIOR_RELEVANT_EXPERIENCE',
        experienceText: 'prior relevant experience',
      },
    }, required, [])).toThrow('Entry qualification requires cited exact JD evidence');
  });

  it('enforces category-aware validation for credentialKind', () => {
    const degreeQuote = "Bachelor's degree in Computer Science is required";
    const req = {
      id: 'REQ-001', requirement: degreeQuote, strength: 'REQUIRED' as const,
      roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Education.',
    };

    // "Bachelor's degree" + DEGREE -> accepted
    expect(materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'MANDATORY_CREDENTIAL',
      exactSourceQuote: degreeQuote,
      basisSupport: {
        kind: 'MANDATORY_CREDENTIAL',
        credentialText: "Bachelor's degree",
        credentialKind: 'DEGREE',
      },
      reasoning: 'Academic degree.',
    }, req, [degreeQuote]).screeningGate).toBe(true);

    // "Bachelor's degree" + CERTIFICATION -> rejected
    expect(() => materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'MANDATORY_CREDENTIAL',
      exactSourceQuote: degreeQuote,
      basisSupport: {
        kind: 'MANDATORY_CREDENTIAL',
        credentialText: "Bachelor's degree",
        credentialKind: 'CERTIFICATION',
      },
      reasoning: 'Mismatched credential kind.',
    }, req, [degreeQuote])).toThrow('MANDATORY_CREDENTIAL with CERTIFICATION requires source text denoting certification or certified status');

    // Non-degree positive example: PMP certification + CERTIFICATION -> accepted
    const certQuote = 'Active PMP certification or equivalent';
    const certReq = {
      id: 'REQ-002', requirement: certQuote, strength: 'REQUIRED' as const,
      roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-2'], reasoning: 'Cert requirement.',
    };
    expect(materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'MANDATORY_CREDENTIAL',
      exactSourceQuote: certQuote,
      basisSupport: {
        kind: 'MANDATORY_CREDENTIAL',
        credentialText: 'PMP certification',
        credentialKind: 'CERTIFICATION',
      },
      reasoning: 'Active certification required.',
    }, certReq, [certQuote]).screeningGate).toBe(true);

    // Non-degree positive example: Valid medical license + LICENSE -> accepted
    const licenseQuote = 'Must possess an active license';
    const licenseReq = {
      id: 'REQ-003', requirement: licenseQuote, strength: 'REQUIRED' as const,
      roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-3'], reasoning: 'Licensure.',
    };
    expect(materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'MANDATORY_CREDENTIAL',
      exactSourceQuote: licenseQuote,
      basisSupport: {
        kind: 'MANDATORY_CREDENTIAL',
        credentialText: 'active license',
        credentialKind: 'LICENSE',
      },
      reasoning: 'Active license required.',
    }, licenseReq, [licenseQuote]).screeningGate).toBe(true);
  });

  it('rejects internally inconsistent screening adjudications', () => {
    const required = {
      id: 'REQ-001', requirement: 'Relevant experience', strength: 'REQUIRED' as const,
      roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Role requirement.',
    };
    expect(() => materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'NONE',
      reasoning: 'Incomplete.',
      exactSourceQuote: 'Incomplete.',
      basisSupport: { kind: 'NONE' },
    }, required)).toThrow('entry qualification needs a stated gate basis');

    expect(() => materializeStagedScreeningAdjudication({
      screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT',
      gateBasis: 'MANDATORY_CREDENTIAL',
      reasoning: 'Inconsistent.',
      exactSourceQuote: 'Inconsistent.',
      basisSupport: { kind: 'NONE' },
    }, required)).toThrow('role-performance requirement cannot carry an entry gate basis');

    expect(() => materializeStagedScreeningAdjudication({
      screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT',
      gateBasis: 'NONE',
      reasoning: 'Inconsistent.',
      exactSourceQuote: 'Inconsistent.',
      basisSupport: { kind: 'MINIMUM_TENURE', thresholdText: '5 years' },
    }, required)).toThrow('role-performance requirement cannot carry basis support');

    expect(() => materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'MINIMUM_TENURE',
      reasoning: 'Inconsistent kind.',
      exactSourceQuote: '5 years experience required.',
      basisSupport: { kind: 'PRIOR_RELEVANT_EXPERIENCE', experienceText: 'experience' },
    }, required)).toThrow('Gate basis and basisSupport kind must match');

    expect(() => materializeStagedScreeningAdjudication({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'PRIOR_RELEVANT_EXPERIENCE',
      reasoning: 'Inconsistent preference.',
      exactSourceQuote: 'Inconsistent preference.',
      basisSupport: { kind: 'PRIOR_RELEVANT_EXPERIENCE', experienceText: 'Inconsistent preference' },
    }, { ...required, strength: 'PREFERRED' })).toThrow('preferred requirement cannot become an entry qualification');
  });

  it('requires an entry basis to be supported by local exact JD qualification wording', () => {
    const required = {
      id: 'REQ-001', requirement: 'Data-driven growth tools', strength: 'REQUIRED' as const,
      roleImportance: 'ENABLER' as const, roleClaimIds: ['JD-1'], reasoning: 'Useful for delivery.',
    };
    expect(validateScreening({
      screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT',
      gateBasis: 'NONE',
      reasoning: 'Tool proficiency is performed within the role.',
      exactSourceQuote: 'Proficiency in data-driven growth tools including Google Sheets and Tableau.',
      basisSupport: { kind: 'NONE' },
    }, required, ['Proficiency in data-driven growth tools including Google Sheets and Tableau.']).screeningGate).toBe(false);

    expect(validateScreening({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'PRIOR_RELEVANT_EXPERIENCE',
      reasoning: 'The employer requires relevant prior experience.',
      exactSourceQuote: 'Candidates must have relevant experience in operations.',
      basisSupport: {
        kind: 'PRIOR_RELEVANT_EXPERIENCE',
        experienceText: 'relevant experience in operations',
      },
    }, required, ['Candidates must have relevant experience in operations.']).screeningGate).toBe(true);

    expect(() => validateScreening({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'PRIOR_RELEVANT_EXPERIENCE',
      reasoning: 'Paraphrase is not source evidence.',
      exactSourceQuote: 'Relevant experience is required.',
      basisSupport: {
        kind: 'PRIOR_RELEVANT_EXPERIENCE',
        experienceText: 'Relevant experience is required.',
      },
    }, required, ['Candidates must have relevant experience in operations.']))
      .toThrow('exactSourceQuote is not contained');
  });

  it('requires basisSupport spans to be exact substrings of exactSourceQuote', () => {
    const required = {
      id: 'REQ-001', requirement: 'Experience requirement', strength: 'REQUIRED' as const,
      roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Required.',
    };
    const quote = 'Candidates must bring 5+ years of experience in product management.';
    expect(() => validateScreening({
      screeningFunction: 'ENTRY_QUALIFICATION',
      gateBasis: 'MINIMUM_TENURE',
      reasoning: 'Fabricated threshold.',
      exactSourceQuote: quote,
      basisSupport: {
        kind: 'MINIMUM_TENURE',
        thresholdText: '10 years',
      },
    }, required, [quote])).toThrow('thresholdText must be copied exactly from exactSourceQuote');
  });

  describe('negative controls', () => {
    it('regresses original semantic defect: rejects New Product Development skills as ENTRY_QUALIFICATION + MINIMUM_TENURE and accepts as ROLE_PERFORMANCE_REQUIREMENT', () => {
      const quote = 'New Product Development skills';
      const requirement = {
        id: 'REQ-001', requirement: quote, strength: 'REQUIRED' as const,
        roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Required skill.',
      };

      expect(() =>
        materializeStagedScreeningAdjudication(
          {
            screeningFunction: 'ENTRY_QUALIFICATION',
            gateBasis: 'MINIMUM_TENURE',
            exactSourceQuote: quote,
            basisSupport: {
              kind: 'MINIMUM_TENURE',
              thresholdText: quote,
            },
            reasoning: 'Incorrect tenure interpretation.',
          },
          requirement,
          [quote],
        )
      ).toThrow(
        'MINIMUM_TENURE requires an exact source-bound duration threshold'
      );

      const result = materializeStagedScreeningAdjudication(
        {
          screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT',
          gateBasis: 'NONE',
          exactSourceQuote: quote,
          basisSupport: {
            kind: 'NONE',
          },
          reasoning: 'The source states a role capability, not a tenure threshold.',
        },
        requirement,
        [quote],
      );

      expect(result.screeningGate).toBe(false);
      expect(result.screeningFunction).toBe('ROLE_PERFORMANCE_REQUIREMENT');
      expect(result.gateBasis).toBe('NONE');
    });

    it('classifies Strong track record of driving cross-functional alignment as ROLE_PERFORMANCE_REQUIREMENT', () => {
      const quote = 'Strong track record of driving cross-functional alignment';
      const req = {
        id: 'REQ-001', requirement: quote, strength: 'REQUIRED' as const,
        roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Alignment capability.',
      };
      expect(() => materializeStagedScreeningAdjudication({
        screeningFunction: 'ENTRY_QUALIFICATION',
        gateBasis: 'MINIMUM_TENURE',
        exactSourceQuote: quote,
        basisSupport: {
          kind: 'MINIMUM_TENURE',
          thresholdText: 'track record',
        },
        reasoning: 'Attempted tenure gate without duration.',
      }, req, [quote])).toThrow('MINIMUM_TENURE requires an exact source-bound duration threshold');

      const perfResult = materializeStagedScreeningAdjudication({
        screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT',
        gateBasis: 'NONE',
        exactSourceQuote: quote,
        basisSupport: { kind: 'NONE' },
        reasoning: 'On-the-job execution capability.',
      }, req, [quote]);
      expect(perfResult.screeningGate).toBe(false);
      expect(perfResult.screeningFunction).toBe('ROLE_PERFORMANCE_REQUIREMENT');
      expect(perfResult.gateBasis).toBe('NONE');
    });

    it('B: rejects Knowledge of GA4, Google Tag Manager, and conversion/call tracking as MANDATORY_CREDENTIAL', () => {
      const quote = 'Knowledge of GA4, Google Tag Manager, and conversion/call tracking';
      const req = {
        id: 'REQ-002', requirement: quote, strength: 'REQUIRED' as const,
        roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Tool knowledge.',
      };
      expect(() => materializeStagedScreeningAdjudication({
        screeningFunction: 'ENTRY_QUALIFICATION',
        gateBasis: 'MANDATORY_CREDENTIAL',
        exactSourceQuote: quote,
        basisSupport: {
          kind: 'MANDATORY_CREDENTIAL',
          credentialText: 'GA4, Google Tag Manager',
          credentialKind: 'CERTIFICATION',
        },
        reasoning: 'Tool knowledge is not a formal credential.',
      }, req, [quote])).toThrow('MANDATORY_CREDENTIAL with CERTIFICATION requires source text denoting certification or certified status');
    });

    it('C: rejects Strong grounding in change frameworks with ability to apply them pragmatically as PRIOR_RELEVANT_EXPERIENCE', () => {
      const quote = 'Strong grounding in change frameworks with ability to apply them pragmatically';
      const req = {
        id: 'REQ-003', requirement: quote, strength: 'REQUIRED' as const,
        roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Change framework grounding.',
      };
      expect(() => materializeStagedScreeningAdjudication({
        screeningFunction: 'ENTRY_QUALIFICATION',
        gateBasis: 'PRIOR_RELEVANT_EXPERIENCE',
        exactSourceQuote: quote,
        basisSupport: {
          kind: 'PRIOR_RELEVANT_EXPERIENCE',
          experienceText: 'Strong grounding in change frameworks',
        },
        reasoning: 'Grounding without retrospective experiential framing.',
      }, req, [quote])).toThrow('PRIOR_RELEVANT_EXPERIENCE requires exact source-bound retrospective experience');
    });
  });

  describe('positive controls', () => {
    it('accepts Minimum 10 years of experience in food & beverage or Pharma industry as MINIMUM_TENURE', () => {
      const quote = 'Minimum 10 years of experience in food & beverage or Pharma industry';
      const req = { id: 'REQ-P1', requirement: quote, strength: 'REQUIRED' as const, roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Tenure requirement.' };
      const res = materializeStagedScreeningAdjudication({
        screeningFunction: 'ENTRY_QUALIFICATION',
        gateBasis: 'MINIMUM_TENURE',
        exactSourceQuote: quote,
        basisSupport: {
          kind: 'MINIMUM_TENURE',
          thresholdText: 'Minimum 10 years',
        },
        reasoning: 'Explicit 10-year industry tenure requirement.',
      }, req, [quote]);
      expect(res.screeningGate).toBe(true);
      expect(res.gateBasis).toBe('MINIMUM_TENURE');
    });

    it('accepts Bachelor\'s degree in Food Science & Technology or in Pharma as MANDATORY_CREDENTIAL', () => {
      const quote = "Bachelor's degree in Food Science & Technology or in Pharma";
      const req = { id: 'REQ-P2', requirement: quote, strength: 'REQUIRED' as const, roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Degree requirement.' };
      const res = materializeStagedScreeningAdjudication({
        screeningFunction: 'ENTRY_QUALIFICATION',
        gateBasis: 'MANDATORY_CREDENTIAL',
        exactSourceQuote: quote,
        basisSupport: {
          kind: 'MANDATORY_CREDENTIAL',
          credentialText: "Bachelor's degree",
          credentialKind: 'DEGREE',
        },
        reasoning: 'Formal educational degree requirement.',
      }, req, [quote]);
      expect(res.screeningGate).toBe(true);
      expect(res.gateBasis).toBe('MANDATORY_CREDENTIAL');
    });

    it('accepts 5+ years of professional experience in marketing or advertising as MINIMUM_TENURE', () => {
      const quote = '5+ years of professional experience in marketing or advertising';
      const req = { id: 'REQ-P3', requirement: quote, strength: 'REQUIRED' as const, roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: '5+ years experience.' };
      const res = materializeStagedScreeningAdjudication({
        screeningFunction: 'ENTRY_QUALIFICATION',
        gateBasis: 'MINIMUM_TENURE',
        exactSourceQuote: quote,
        basisSupport: {
          kind: 'MINIMUM_TENURE',
          thresholdText: '5+ years',
        },
        reasoning: 'Explicit duration threshold.',
      }, req, [quote]);
      expect(res.screeningGate).toBe(true);
      expect(res.gateBasis).toBe('MINIMUM_TENURE');
    });

    it('accepts Experience integrating change into agile / product-based delivery models as PRIOR_RELEVANT_EXPERIENCE', () => {
      const quote = 'Experience integrating change into agile / product-based delivery models';
      const req = { id: 'REQ-P4', requirement: quote, strength: 'REQUIRED' as const, roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Change integration experience.' };
      const res = materializeStagedScreeningAdjudication({
        screeningFunction: 'ENTRY_QUALIFICATION',
        gateBasis: 'PRIOR_RELEVANT_EXPERIENCE',
        exactSourceQuote: quote,
        basisSupport: {
          kind: 'PRIOR_RELEVANT_EXPERIENCE',
          experienceText: 'Experience integrating change',
        },
        reasoning: 'Retrospective experience integrating change.',
      }, req, [quote]);
      expect(res.screeningGate).toBe(true);
      expect(res.gateBasis).toBe('PRIOR_RELEVANT_EXPERIENCE');
    });

    it('accepts Applicants without hands-on X expertise will not be considered. as EXPLICIT_SHORTLIST_CONDITION', () => {
      const quote = 'Applicants without hands-on X expertise will not be considered.';
      const req = { id: 'REQ-P5', requirement: quote, strength: 'REQUIRED' as const, roleImportance: 'CORE_CAPABILITY' as const, roleClaimIds: ['JD-1'], reasoning: 'Exclusionary condition.' };
      const res = materializeStagedScreeningAdjudication({
        screeningFunction: 'ENTRY_QUALIFICATION',
        gateBasis: 'EXPLICIT_SHORTLIST_CONDITION',
        exactSourceQuote: quote,
        basisSupport: {
          kind: 'EXPLICIT_SHORTLIST_CONDITION',
          selectionConditionText: 'will not be considered',
        },
        reasoning: 'Explicit shortlisting/elimination language.',
      }, req, [quote]);
      expect(res.screeningGate).toBe(true);
      expect(res.gateBasis).toBe('EXPLICIT_SHORTLIST_CONDITION');
    });
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
