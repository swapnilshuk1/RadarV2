import { describe, expect, it } from 'vitest';
import { pinIntelligence } from '../../src/evaluation/intelligence-taxonomy';
import { baselineIntelligenceTaxonomy } from '../../src/lib/ontology/intelligence-taxonomy';

import { contextFields, scopeFields, type Claim, type EvidenceSource, type ReasoningModel } from '../../src/dossier/contracts';
import { chunkStagedDecisionItems, normalizeUnsupportedResolutionDrafts, runStagedFrozenDecisionDetailed, STAGED_DECISION_BATCH_SIZE } from '../../src/dossier/staged-decision';
import { materializeStagedScreeningAdjudication } from '../../src/dossier/staged-screening';
import {
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
} from '../../src/dossier/staged-role';

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
      const adjudicate = (item: any) =>
        item.requirement.strength === 'REQUIRED'
          ? {
              screeningFunction: 'ENTRY_QUALIFICATION',
              gateBasis: 'PRIOR_RELEVANT_EXPERIENCE',
              reasoning: 'The exact JD says candidates must have the prior experience.',
              supportQuoteIds: [item.quoteCatalog[0].id],
            }
          : {
              screeningFunction: 'ROLE_PERFORMANCE_REQUIREMENT',
              gateBasis: 'NONE',
              reasoning: 'The exact JD marks this preferred and not mandatory.',
              supportQuoteIds: [item.quoteCatalog[0].id],
            };
      if (Array.isArray(actual.requirements)) {
        return {
          results: actual.requirements.map((item: any) => ({
            requirementId: item.requirementId,
            adjudication: adjudicate(item),
          })),
        };
      }
      return adjudicate(actual);
    }
    if (instruction.includes('candidate-to-requirement mapper')) {
      const mapRequirement = (requirement: any) =>
        requirement.strength === 'REQUIRED'
          ? { status: 'NOT_EVIDENCED', candidateClaimIds: [], unsupportedAspects: ['Relevant Operations experience'], reasoning: 'Relevant Operations experience is not evidenced in the supplied candidate sources.' }
          : { status: 'NOT_EVIDENCED', candidateClaimIds: [], unsupportedAspects: ['Hindi fluency'], reasoning: 'Hindi fluency is not evidenced in the supplied candidate sources.' };
      if (Array.isArray(actual.requirements)) {
        return {
          results: actual.requirements.map((requirement: any) => ({
            requirementId: requirement.id,
            mapping: mapRequirement(requirement),
          })),
        };
      }
      return mapRequirement(actual.requirement);
    }
    if (instruction.startsWith('Resolve only RADAR')) return { resolutions: openResolutions };
    if (instruction.includes('screening-gap classifier')) {
      const gap = { gapNature: 'MISSING_EXPERIENCE', reasoning: 'The unresolved gate is substantive prior experience, not a missing proof artifact.' };
      if (Array.isArray(actual.requirements)) {
        return {
          results: actual.requirements.map((item: any) => ({
            requirementId: item.requirementId,
            gap,
          })),
        };
      }
      return gap;
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

class UnsupportedResolutionEvidenceModel extends ScriptedModel {
  override readonly id = 'unsupported-resolution-evidence-model';
  override async generate(instruction: string, input: any): Promise<unknown> {
    const result = await super.generate(instruction, input);
    if (instruction.startsWith('Resolve only RADAR')) {
      return {
        resolutions: [
          ...openResolutions.filter(resolution => resolution.field !== 'leadershipChanges'),
          {
            field: 'leadershipChanges', status: 'INFERRED', value: 'Recent leadership change',
            claimIds: [], methods: ['infer'],
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
  const screeningRequirement = {id:'REQ-001',requirement:'Prior operations experience',strength:'REQUIRED' as const,roleImportance:'CORE_CAPABILITY' as const,roleClaimIds:['JD-1']};
  const quotes=[{id:'JD-1:Q1',text:'Candidates must have relevant experience in Operations.'}];
  const entry={screeningFunction:'ENTRY_QUALIFICATION',gateBasis:'PRIOR_RELEVANT_EXPERIENCE',supportQuoteIds:['JD-1:Q1'],reasoning:'Required prior experience.'};
  it('derives the gate from the semantic function, basis and requirement strength',()=>{
    expect(materializeStagedScreeningAdjudication(entry,screeningRequirement,quotes).screeningGate).toBe(true);
    expect(materializeStagedScreeningAdjudication({...entry,screeningFunction:'ROLE_PERFORMANCE_REQUIREMENT',gateBasis:'NONE'},screeningRequirement,quotes).screeningGate).toBe(false);
  });
  it('rejects model-authored screening booleans and the retired quote-copying schema',()=>{
    expect(()=>materializeStagedScreeningAdjudication({...entry,screeningGate:true},screeningRequirement,quotes)).toThrow();
    expect(()=>materializeStagedScreeningAdjudication({screeningFunction:'ENTRY_QUALIFICATION',gateBasis:'PRIOR_RELEVANT_EXPERIENCE',exactSourceQuote:quotes[0].text,basisSupport:{kind:'PRIOR_RELEVANT_EXPERIENCE',experienceText:'experience'},reasoning:'Old format'},screeningRequirement,quotes)).toThrow();
  });
  it('requires an application-owned catalog and exact support IDs',()=>{
    expect(()=>materializeStagedScreeningAdjudication(entry,screeningRequirement,[])).toThrow('application-owned');
    expect(()=>materializeStagedScreeningAdjudication({...entry,supportQuoteIds:['invented']},screeningRequirement,quotes)).toThrow('Unknown support quote id');
    expect(()=>materializeStagedScreeningAdjudication({...entry,supportQuoteIds:['JD-1:Q1','JD-1:Q1']},screeningRequirement,quotes)).toThrow('must not contain duplicates');
    expect(()=>materializeStagedScreeningAdjudication(entry,screeningRequirement,[...quotes,...quotes])).toThrow('duplicate identifiers');
  });
  it('prevents preferred requirements and inconsistent function/basis pairs from becoming gates',()=>{
    expect(()=>materializeStagedScreeningAdjudication(entry,{...screeningRequirement,strength:'PREFERRED'},quotes)).toThrow('preferred requirement');
    expect(()=>materializeStagedScreeningAdjudication({...entry,gateBasis:'NONE'},screeningRequirement,quotes)).toThrow('non-NONE');
    expect(()=>materializeStagedScreeningAdjudication({...entry,screeningFunction:'ROLE_PERFORMANCE_REQUIREMENT'},screeningRequirement,quotes)).toThrow('gateBasis=NONE');
  });
  it('preserves explicit founder/investment joining conditions as role-side conditions', () => {
    const founderClaim: Claim = {
      id: 'JD-3',
      text: 'This is an equity-only co-founder opportunity with no salary and an investment commitment.',
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'JD',
      citations: [{ sourceId: 'JD-SOURCE', quote: 'Equity-only co-founder opportunity with no salary; selected co-founder will invest capital.' }],
      derivedFrom: [],
    };
    const roleClaims=[...claims.filter(claim=>claim.plane==='JD'),founderClaim];
    expect(()=>materializeStagedRoleAnalysis({
      requirements: [{ requirement: 'Relevant experience in Operations', strength: 'REQUIRED', roleImportance: 'CORE_CAPABILITY', roleClaimIds: ['JD-1'], reasoning: 'Required experience.' }],
      operatingConditions: [],
      authorityShape: 'Co-founder operating role',
      roleSideConditions: [],
    },roleClaims)).toThrow('Explicit joining condition must survive as roleSideCondition');

    const role=materializeStagedRoleAnalysis({
      requirements: [{ requirement: 'Relevant experience in Operations', strength: 'REQUIRED', roleImportance: 'CORE_CAPABILITY', roleClaimIds: ['JD-1'], reasoning: 'Required experience.' }],
      operatingConditions: [],
      authorityShape: 'Co-founder operating role',
      roleSideConditions: [{ condition: 'Equity-only founder role with required personal investment and no salary', roleClaimIds: ['JD-3'] }],
    },roleClaims);
    expect(role.roleSideConditions[0].roleClaimIds).toEqual(['JD-3']);
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
    const missingCredential: StagedScreeningDriver = {
      ...base,
      screeningGateBasis: 'MANDATORY_CREDENTIAL',
      gapNature: 'MISSING_EXPERIENCE',
      gapReasoning: 'Degree credential not evidenced.',
    };
    expect(screeningConstraintForDrivers([missingCredential])).toBe('MAX_FRAGILE');
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

    const multipleDefects = {
      ...noCareerCapital,
      authority: { ...noCareerCapital.authority, material: true, candidateClaimIds: ['UNKNOWN'] },
      compensation: { ...noCareerCapital.compensation, candidateClaimIds: ['CANDIDATE-1'] },
    };
    expect(() => validateStagedCareerCapital(multipleDefects, role, [], candidateClaims, true))
      .toThrow(/Unknown authority.*Non-material compensation.*set compensation.candidateClaimIds/);
    // Historical repair behavior remains fail-fast; v7 gets every mechanical defect at once.
    expect(() => validateStagedCareerCapital(multipleDefects, role, [], candidateClaims))
      .toThrow('Unknown authority career-capital candidate claim reference: UNKNOWN');

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

  it('limits pinned advisory taxonomy to role interpretation without changing evidence or screening', async () => {
    const pin = pinIntelligence('test-pinned-revision', baselineIntelligenceTaxonomy);
    const calls: any[] = [];
    const scripted = new ScriptedModel();
    const model: ReasoningModel = { id: 'taxonomy-reference-test', version: '1', generate: async (instruction, input, _schema, metadata) => {
      calls.push(input);
      if(metadata?.stage === 'role-interpretation') expect(instruction).toContain('never candidate-fit levels');
      else expect(input).not.toHaveProperty('intelligenceTaxonomy');
      return scripted.generate(instruction, input);
    }};
    const original = JSON.stringify(frozen);
    const result = await runStagedFrozenDecisionDetailed({ ...frozen, intelligenceTaxonomy: pin }, model);
    expect(calls.length).toBeGreaterThan(4);
    expect(calls.filter(call => call.intelligenceTaxonomy).length).toBe(1);
    expect(calls.find(call => call.intelligenceTaxonomy).intelligenceTaxonomy.fingerprint).toBe(pin.fingerprint);
    expect(result.decision).toMatchObject({ verdict: 'PASS', screeningViability: 'BLOCKED' });
    expect(JSON.stringify(frozen)).toBe(original);
  });

  it('keys cached role interpretation by pinned taxonomy and reuses the same pin', async () => {
    let roleCalls = 0;
    const model: ReasoningModel = { id: 'taxonomy-cache-regression', version: '1', configurationFingerprint: 'same-config', generate: async (instruction, input, _schema, metadata) => {
      if (metadata?.stage === 'role-interpretation') roleCalls++;
      return new ScriptedModel().generate(instruction, input);
    }};
    const first = pinIntelligence('revision-a', baselineIntelligenceTaxonomy);
    const graph = structuredClone(baselineIntelligenceTaxonomy);
    graph.nodes[0].name += ' revised';
    const second = pinIntelligence('revision-b', graph);
    await runStagedFrozenDecisionDetailed({ ...frozen, intelligenceTaxonomy: first }, model);
    expect(roleCalls).toBe(1);
    await runStagedFrozenDecisionDetailed({ ...frozen, intelligenceTaxonomy: second }, model);
    expect(roleCalls).toBe(2);
    await runStagedFrozenDecisionDetailed({ ...frozen, intelligenceTaxonomy: second }, model);
    expect(roleCalls).toBe(2);
  });

  it('caps staged batch repair blast radius at ten requirements', () => {
    const items=Array.from({length:23},(_,index)=>index+1);
    const chunks=chunkStagedDecisionItems(items);
    expect(STAGED_DECISION_BATCH_SIZE).toBe(10);
    expect(chunks.map(chunk=>chunk.length)).toEqual([10,10,3]);
    expect(chunks.flat()).toEqual(items);
  });

  it('batches screening, mapping and gap transport without collapsing their semantic validators', async () => {
    class CountingBatchModel extends ScriptedModel {
      override readonly id='counting-batch-model';
      readonly instructions:string[]=[];
      override async generate(instruction:string,input:any):Promise<unknown>{
        this.instructions.push(instruction);
        return super.generate(instruction,input);
      }
    }
    const model=new CountingBatchModel();
    const result=await runStagedFrozenDecisionDetailed(frozen,model);
    expect(result.decision.verdict).toBe('PASS');
    expect(model.instructions.filter(value=>value.includes('screening adjudicator'))).toHaveLength(1);
    expect(model.instructions.filter(value=>value.includes('candidate-to-requirement mapper'))).toHaveLength(1);
    expect(model.instructions.filter(value=>value.includes('screening-gap classifier'))).toHaveLength(1);
    expect(model.instructions).toHaveLength(7);
  });

  it.each([
    {
      label: 'Reach Digital company size',
      field: 'companySize',
      claim: {
        id: 'CONTEXT-1',
        text: 'Reach Digital has a headcount of 2-10 employees.',
        state: 'EXPLICIT',
        confidence: 1,
        plane: 'CONTEXT',
        citations: [{ sourceId: 'CONTEXT-SOURCE', quote: 'Company size: 2-10 employees.' }],
        derivedFrom: [],
      } as Claim,
    },
    {
      label: 'Guru Dhoondo growth target',
      field: 'growth',
      claim: {
        id: 'JD-3',
        text: 'Scale daily sessions from 5 to 45 by March 2027.',
        state: 'EXPLICIT',
        confidence: 1,
        plane: 'JD',
        citations: [{ sourceId: 'JD-SOURCE', quote: 'Scale from ~5 to 45 sessions/day by March 2027.' }],
        derivedFrom: [],
      } as Claim,
    },
  ])('does not lose explicit $label evidence during field resolution', async ({field,claim}) => {
    const contextSource: EvidenceSource = {
      id: 'CONTEXT-SOURCE', plane: 'CONTEXT', title: 'Company profile', locator: 'fixture://context',
      text: 'Company size: 2-10 employees.', capturedAt: '2026-09-16T00:00:00.000Z', attribution: 'INDEPENDENT',
    };
    await expect(runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity: {...frozen.opportunity,id:`evidence-conservation-${field}`},
      sources: claim.plane==='CONTEXT'?[...frozen.sources,contextSource]:frozen.sources,
      evidence:[...claims,claim],
      validEvidenceClaimIds:[...claims.map(item=>item.id),claim.id],
    },new ScriptedModel())).rejects.toThrow(`OPEN field has sufficient validated evidence: ${field}`);
  });

  it('does not confuse company headcount or brand workload with role team scale', async () => {
    const brandSource: EvidenceSource = {
      id: 'JD-BRANDS', plane: 'JD', title: 'Reach Digital role', locator: 'fixture://reach-role',
      text: 'Manage 3-5 brand partners at a time.', capturedAt: '2026-09-28T00:00:00.000Z', attribution: 'JOB_POST',
    };
    const contextSource: EvidenceSource = {
      id: 'CONTEXT-SIZE', plane: 'CONTEXT', title: 'Reach Digital company profile', locator: 'fixture://reach-company',
      text: 'Company Size\n2-10 employees', capturedAt: '2026-09-28T00:00:00.000Z', attribution: 'INDEPENDENT',
    };
    const brandClaim: Claim = {
      id: 'JD-BRAND-COUNT',
      text: 'Manage 3-5 brand partners at a time.',
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'JD',
      citations: [{ sourceId: brandSource.id, quote: 'Manage 3-5 brand partners at a time.' }],
      derivedFrom: [],
    };
    const sizeClaim: Claim = {
      id: 'CONTEXT-SIZE-CLAIM',
      text: 'Reach Digital has 2-10 employees.',
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'CONTEXT',
      citations: [{ sourceId: contextSource.id, quote: '2-10 employees' }],
      derivedFrom: [],
    };

    class TeamScaleConfusionModel extends ScriptedModel {
      override readonly id = 'team-scale-confusion-model';
      override async generate(instruction: string, input: any): Promise<unknown> {
        if (instruction.startsWith('Resolve only RADAR')) {
          return {
            resolutions: openResolutions.map((resolution) => {
              if (resolution.field === 'companySize') {
                return {
                  field: 'companySize',
                  status: 'RESOLVED',
                  value: '2-10 employees',
                  claimIds: [sizeClaim.id],
                  methods: ['extract'],
                };
              }
              if (resolution.field === 'teamScale') {
                return {
                  field: 'teamScale',
                  status: 'RESOLVED',
                  value: '3-5 direct reports',
                  claimIds: [brandClaim.id, sizeClaim.id],
                  methods: ['extract'],
                };
              }
              return resolution;
            }),
          };
        }
        return super.generate(instruction, input);
      }
    }

    const result = await runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity: { ...frozen.opportunity, id: 'reach-team-scale-semantics' },
      sources: [...frozen.sources, brandSource, contextSource],
      evidence: [...claims, brandClaim, sizeClaim],
      validEvidenceClaimIds: [...claims.map(claim => claim.id), brandClaim.id, sizeClaim.id],
    }, new TeamScaleConfusionModel());

    expect(result.trace.resolutions.find(resolution => resolution.field === 'companySize')).toMatchObject({
      status: 'RESOLVED',
      value: '2-10 employees',
    });
    expect(result.trace.resolutions.find(resolution => resolution.field === 'teamScale')).toMatchObject({
      status: 'OPEN',
      value: null,
      claimIds: [],
      question: 'What direct-report or people-management scale does this role actually own?',
    });
  });

  it('does not present an unverified canonical-company and JD business name as aliases', async () => {
    const guruClaim: Claim = {
      id: 'JD-3',
      text: 'Guru Dhoondo is a live tutoring marketplace.',
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'JD',
      citations: [{ sourceId: 'JD-SOURCE', quote: 'Guru Dhoondo is a live tutoring marketplace.' }],
      derivedFrom: [],
    };

    class AliasQuestionModel extends ScriptedModel {
      override readonly id = 'alias-question-model';
      override async generate(instruction: string, input: any): Promise<unknown> {
        if (instruction.startsWith('Resolve only RADAR')) {
          return {
            resolutions: openResolutions.map((resolution) =>
              resolution.field === 'companySize'
                ? {
                    ...resolution,
                    question: 'What is the total employee headcount of Fortaxe (Guru Dhoondo)?',
                  }
                : resolution,
            ),
          };
        }
        return super.generate(instruction, input);
      }
    }

    const safe = await runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity: {
        id: 'guru-unverified-alias-open',
        company: 'Fortaxe',
        title: 'Head of Growth & Marketing at Guru Dhoondo',
      },
      evidence: [...claims, guruClaim],
      validEvidenceClaimIds: [...claims.map(claim => claim.id), guruClaim.id],
    }, new AliasQuestionModel());

    expect(safe.trace.resolutions.find(resolution => resolution.field === 'companySize')?.question)
      .toBe('What is the total employee headcount of the opportunity business?');

    class AliasFactModel extends ScriptedModel {
      override readonly id = 'alias-fact-model';
      override async generate(instruction: string, input: any): Promise<unknown> {
        if (instruction.startsWith('Resolve only RADAR')) {
          return {
            resolutions: openResolutions.map((resolution) =>
              resolution.field === 'companySize'
                ? {
                    field: 'companySize',
                    status: 'RESOLVED',
                    value: 'Fortaxe (Guru Dhoondo) has 10 employees.',
                    claimIds: ['JD-3'],
                    methods: ['extract'],
                  }
                : resolution,
            ),
          };
        }
        return super.generate(instruction, input);
      }
    }

    await expect(runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity: {
        id: 'guru-unverified-alias-resolved',
        company: 'Fortaxe',
        title: 'Head of Growth & Marketing at Guru Dhoondo',
      },
      evidence: [...claims, guruClaim],
      validEvidenceClaimIds: [...claims.map(claim => claim.id), guruClaim.id],
    }, new AliasFactModel())).rejects.toThrow(
      'Unsupported company alias assertion in resolved field: companySize',
    );
  });

  it('does not treat an open leadership search as a completed leadership change', async () => {
    const searchClaim: Claim = {
      id: 'JD-3',
      text: 'The company is looking for a Co-Founder & CMO to join at the early stage.',
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'JD',
      citations: [{ sourceId: 'JD-SOURCE', quote: 'We are looking for a Co-Founder & CMO to join at the early stage.' }],
      derivedFrom: [],
    };
    const roleClaim: Claim = {
      id: 'JD-4',
      text: 'The role is Co-Founder & CMO at the pre-market stage.',
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'JD',
      citations: [{ sourceId: 'JD-SOURCE', quote: 'Role: Co-Founder & CMO. Stage: Pre-market.' }],
      derivedFrom: [],
    };

    class LeadershipSearchModel extends ScriptedModel {
      override readonly id = 'leadership-search-model';
      override async generate(instruction: string, input: any): Promise<unknown> {
        if (instruction.includes('role interpreter')) {
          return {
            requirements: [
              { requirement: 'Relevant experience in Operations', strength: 'REQUIRED', roleImportance: 'CORE_CAPABILITY', roleClaimIds: ['JD-1'], reasoning: 'Explicit prior-experience qualification.' },
              { requirement: 'Hindi fluency', strength: 'PREFERRED', roleImportance: 'ENABLER', roleClaimIds: ['JD-2'], reasoning: 'Explicit preference.' },
            ],
            operatingConditions: [],
            authorityShape: 'Co-founder operating role',
            roleSideConditions: [
              { condition: 'Founder-status opportunity', roleClaimIds: ['JD-3'] },
            ],
          };
        }
        if (instruction.startsWith('Resolve only RADAR')) {
          return {
            resolutions: openResolutions.map((resolution) =>
              resolution.field === 'leadershipChanges'
                ? {
                    field: 'leadershipChanges',
                    status: 'RESOLVED',
                    value: 'Seeking to appoint inaugural Co-Founder & CMO.',
                    claimIds: ['JD-3', 'JD-4'],
                    methods: ['extract'],
                  }
                : resolution,
            ),
          };
        }
        return super.generate(instruction, input);
      }
    }

    await expect(runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity: { ...frozen.opportunity, id: 'better-days-open-leadership-search' },
      evidence: [...claims, searchClaim, roleClaim],
      validEvidenceClaimIds: [...claims.map(claim => claim.id), searchClaim.id, roleClaim.id],
    }, new LeadershipSearchModel())).rejects.toThrow(
      'Leadership changes require a completed appointment, departure, or succession event; an open leadership search is not a leadership change',
    );
  });

  it.each([
    {
      name: 'funding status inside growth',
      field: 'growth',
      plane: 'CONTEXT',
      text: 'Reach Digital creates over 500 ads monthly.',
      status: 'INFERRED',
      value: 'Scale-up traction from 500+ ads monthly; operates as a funded startup.',
      methods: ['derive'],
      error: 'Growth cannot invent funding status that is absent from its cited evidence',
    },
    {
      name: 'uncited monetary scale inside growth',
      field: 'growth',
      plane: 'CONTEXT',
      text: 'Reach Digital creates over 500 ads monthly.',
      status: 'INFERRED',
      value: 'Scale-up traction from 500+ ads monthly and $50M+ media spend.',
      methods: ['derive'],
      error: 'Growth cannot introduce monetary scale that is absent from its cited evidence',
    },
  ])('rejects $name', async ({field,plane,text,status,value,methods,error}) => {
    const guardClaim: Claim = {
      id: 'GUARD-CLAIM',
      text,
      state: 'EXPLICIT',
      confidence: 1,
      plane: plane as Claim['plane'],
      citations: [{ sourceId: 'JD-SOURCE', quote: text }],
      derivedFrom: [],
    };
    class ResolutionGuardModel extends ScriptedModel {
      override readonly id = 'resolution-guard-model';
      override async generate(instruction: string, input: any): Promise<unknown> {
        if (instruction.startsWith('Resolve only RADAR')) {
          return {
            resolutions: openResolutions.map((resolution) =>
              resolution.field === field
                ? {
                    field,
                    status,
                    value,
                    claimIds: ['GUARD-CLAIM'],
                    methods,
                  }
                : resolution,
            ),
          };
        }
        return super.generate(instruction, input);
      }
    }

    await expect(runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity: { ...frozen.opportunity, id: `guard-${field}` },
      evidence: [...claims, guardClaim],
      validEvidenceClaimIds: [...claims.map(claim => claim.id), guardClaim.id],
    }, new ResolutionGuardModel())).rejects.toThrow(error);
  });

  it.each([
    {
      name: 'partial team composition as organizational structure',
      field: 'organizationalStructure',
      text: 'The company is a fully remote team of creatives, editors, and growth strategists.',
      status: 'RESOLVED',
      value: '2 co-founders as CEOs; flat remote team of creatives and growth strategists.',
      methods: ['extract'],
    },
    {
      name: 'career progression as workforce trajectory',
      field: 'workforceTrajectory',
      text: 'The company offers room to grow into senior roles as Reach scales.',
      status: 'INFERRED',
      value: 'Active hiring expansion as the company scales.',
      methods: ['derive'],
    },
    {
      name: 'single vacancy as workforce trajectory',
      field: 'workforceTrajectory',
      text: 'The company is hiring for one Creative Strategist role.',
      status: 'INFERRED',
      value: 'Company workforce is expanding.',
      methods: ['derive'],
    },
    {
      name: 'career progression as related hiring',
      field: 'relatedHiring',
      text: 'The company offers room to grow into senior roles as Reach scales.',
      status: 'RESOLVED',
      value: 'Active hiring for additional Creative Strategist roles.',
      methods: ['extract'],
    },
    {
      name: 'brand-partner count as team scale',
      field: 'teamScale',
      text: 'Own creative strategy for 3-5 brand partners concurrently.',
      status: 'RESOLVED',
      value: '3-5 team members',
      methods: ['extract'],
    },
  ])('downgrades $name to OPEN', async ({field,text,status,value,methods}) => {
    const contextClaim: Claim = {
      id: 'JD-CONTEXT-GUARD',
      text,
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'JD',
      citations: [{ sourceId: 'JD-SOURCE', quote: text }],
      derivedFrom: [],
    };
    class ContextNormalizationModel extends ScriptedModel {
      override readonly id = 'context-normalization-model';
      override async generate(instruction: string, input: any): Promise<unknown> {
        if (instruction.startsWith('Resolve only RADAR')) {
          return {
            resolutions: openResolutions.map((resolution) =>
              resolution.field === field
                ? {
                    field,
                    status,
                    value,
                    claimIds: ['JD-CONTEXT-GUARD'],
                    methods,
                  }
                : resolution,
            ),
          };
        }
        return super.generate(instruction, input);
      }
    }
    const result = await runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity: { ...frozen.opportunity, id: `context-normalization-${field}` },
      evidence: [...claims, contextClaim],
      validEvidenceClaimIds: [...claims.map(claim => claim.id), contextClaim.id],
    }, new ContextNormalizationModel());

    expect(result.trace.resolutions.find(resolution => resolution.field === field)).toMatchObject({
      status: 'OPEN',
      value: null,
      claimIds: [],
    });
  });

  it('does not fuse company size and a separate single vacancy into workforce movement', async () => {
    const sizeClaim: Claim = {
      id: 'JD-COMPANY-SIZE',
      text: 'The company has 10 employees',
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'JD',
      citations: [{ sourceId: 'JD-SOURCE', quote: 'The company has 10 employees' }],
      derivedFrom: [],
    };
    const vacancyClaim: Claim = {
      id: 'JD-SINGLE-VACANCY',
      text: 'The company is hiring a Creative Strategist.',
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'JD',
      citations: [{ sourceId: 'JD-SOURCE', quote: 'The company is hiring a Creative Strategist.' }],
      derivedFrom: [],
    };
    class WorkforceFusionModel extends ScriptedModel {
      override readonly id = 'workforce-fusion-model';
      override async generate(instruction: string, input: any): Promise<unknown> {
        if (instruction.startsWith('Resolve only RADAR')) {
          return {
            resolutions: openResolutions.map((resolution) =>
              resolution.field === 'workforceTrajectory'
                ? {
                    field: 'workforceTrajectory',
                    status: 'INFERRED',
                    value: 'Company workforce is expanding.',
                    claimIds: [sizeClaim.id, vacancyClaim.id],
                    methods: ['derive'],
                  }
                : resolution,
            ),
          };
        }
        return super.generate(instruction, input);
      }
    }

    const result = await runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity: { ...frozen.opportunity, id: 'workforce-no-cross-claim-fusion' },
      evidence: [...claims, sizeClaim, vacancyClaim],
      validEvidenceClaimIds: [...claims.map(claim => claim.id), sizeClaim.id, vacancyClaim.id],
    }, new WorkforceFusionModel());

    expect(result.trace.resolutions.find(resolution => resolution.field === 'workforceTrajectory')).toMatchObject({
      status: 'OPEN',
      value: null,
      claimIds: [],
    });
  });

  it('accepts an explicit company headcount increase as workforce movement', async () => {
    const workforceClaim: Claim = {
      id: 'JD-WORKFORCE-MOVEMENT',
      text: 'Company headcount expansion moved staffing from 10 to 25 over the last year.',
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'JD',
      citations: [{ sourceId: 'JD-SOURCE', quote: 'Company headcount expansion moved staffing from 10 to 25 over the last year.' }],
      derivedFrom: [],
    };
    class WorkforceMovementModel extends ScriptedModel {
      override readonly id = 'workforce-movement-model';
      override async generate(instruction: string, input: any): Promise<unknown> {
        if (instruction.startsWith('Resolve only RADAR')) {
          return {
            resolutions: openResolutions.map((resolution) =>
              resolution.field === 'workforceTrajectory'
                ? {
                    field: 'workforceTrajectory',
                    status: 'INFERRED',
                    value: 'Company headcount expanded from 10 to 25 over the last year.',
                    claimIds: [workforceClaim.id],
                    methods: ['derive'],
                  }
                : resolution,
            ),
          };
        }
        return super.generate(instruction, input);
      }
    }

    const result = await runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity: { ...frozen.opportunity, id: 'workforce-explicit-headcount-growth' },
      evidence: [...claims, workforceClaim],
      validEvidenceClaimIds: [...claims.map(claim => claim.id), workforceClaim.id],
    }, new WorkforceMovementModel());

    expect(result.trace.resolutions.find(resolution => resolution.field === 'workforceTrajectory')).toMatchObject({
      status: 'INFERRED',
      value: 'Company headcount expanded from 10 to 25 over the last year.',
      claimIds: [workforceClaim.id],
    });
  });

  it('accepts explicit geographic market expansion even when another cited claim mentions recruiting', async () => {
    const expansionSource: EvidenceSource = {
      id: 'JD-EXPANSION',
      plane: 'JD',
      title: 'Guru Dhoondo role',
      locator: 'fixture://guru-expansion',
      text: 'The company has a 7 year plan to scale nationally and internationally. Guru/tutor side growth involves recruiting supply through LinkedIn and job boards. As the company scales, channel strategy will adapt for international markets as the company expands beyond India.',
      capturedAt: '2026-09-28T00:00:00.000Z',
      attribution: 'JOB_POST',
    };
    const expansionClaim: Claim = {
      id: 'JD-3',
      text: 'The company has a 7 year plan to scale nationally and internationally.',
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'JD',
      citations: [{ sourceId: expansionSource.id, quote: 'The company has a 7 year plan to scale nationally and internationally.' }],
      derivedFrom: [],
    };
    const recruitingClaim: Claim = {
      id: 'JD-4',
      text: 'Guru/tutor side growth involves recruiting supply through LinkedIn and job boards.',
      state: 'EXPLICIT',
      confidence: 1,
      plane: 'JD',
      citations: [{ sourceId: expansionSource.id, quote: 'Guru/tutor side growth involves recruiting supply through LinkedIn and job boards.' }],
      derivedFrom: [],
    };
    class MarketExpansionModel extends ScriptedModel {
      override readonly id = 'market-expansion-model';
      override async generate(instruction: string, input: any): Promise<unknown> {
        if (instruction.startsWith('Resolve only RADAR')) {
          return {
            resolutions: openResolutions.map((resolution) =>
              resolution.field === 'marketExpansion'
                ? {
                    field: 'marketExpansion',
                    status: 'RESOLVED',
                    value: 'Seven-year national and international expansion plan, including expansion beyond India.',
                    claimIds: ['JD-3', 'JD-4'],
                    methods: ['extract'],
                  }
                : resolution,
            ),
          };
        }
        return super.generate(instruction, input);
      }
    }

    const result = await runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity: { ...frozen.opportunity, id: 'guru-market-expansion' },
      sources: [...frozen.sources, expansionSource],
      evidence: [...claims, expansionClaim, recruitingClaim],
      validEvidenceClaimIds: [...claims.map(claim => claim.id), expansionClaim.id, recruitingClaim.id],
    }, new MarketExpansionModel());

    expect(result.trace.resolutions.find(resolution => resolution.field === 'marketExpansion')).toMatchObject({
      status: 'RESOLVED',
      claimIds: ['JD-3', 'JD-4'],
    });
  });

  it('rejects OPEN when direct validated evidence already answers the field', async () => {
    const reportingClaim: Claim = {
      id: 'JD-3', text: 'The role reports directly to the founders', state: 'EXPLICIT', confidence: 1, plane: 'JD',
      citations: [{ sourceId: 'JD-SOURCE', quote: 'The role reports directly to the founders.' }], derivedFrom: [],
    };
    await expect(runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity: {...frozen.opportunity, id: 'evidence-conservation'},
      evidence: [...claims, reportingClaim],
      validEvidenceClaimIds: [...claims.map(claim => claim.id), reportingClaim.id],
    }, new ScriptedModel())).rejects.toThrow('OPEN field has sufficient validated evidence: reportingLine');
  });

  it('supplies candidate evidence and explicit pursuit semantics to the staged-v8 decision stage', async()=>{
    let request:any,wording='';
    class CapturingModel extends ScriptedModel {
      async generate(instruction:string,input:any){if(instruction.includes('executive decision reasoner')){request=input.input??input;wording=instruction;}return super.generate(instruction,input);}
    }
    const candidateDecisionProfile = {
      projection: { currentTitle: 'SVP', yearsExperience: 20, coreCapabilities: ['GROWTH'] },
      intent: { targetTitles: ['CMO'], preferredLocations: ['India'], decisionPreferences: { careerMove: 'PROGRESSION' } },
    };
    await runStagedFrozenDecisionDetailed({...frozen,candidateDecisionProfile,opportunity:{...frozen.opportunity,id:'decision-evidence-v8'}},new CapturingModel());
    expect(request.candidateClaims).toEqual(claims.filter(claim=>claim.plane==='CANDIDATE'));
    expect(request.candidateDecisionProfile).toEqual(candidateDecisionProfile);
    expect(request.candidateConflicts).toEqual(frozen.candidateConflicts);
    expect(wording).toContain('PASS means DO_NOT_PURSUE');
    expect(wording).toContain('CONSIDER means investigate');
  });

  it('downgrades a context resolution with no evidence to OPEN instead of fabricating support', () => {
    expect(normalizeUnsupportedResolutionDrafts([{
      field: 'leadershipChanges', status: 'INFERRED', value: 'Recent leadership change',
      claimIds: [], methods: ['infer'],
    }])).toEqual([{
      field: 'leadershipChanges', status: 'OPEN', value: null,
      claimIds: [], methods: ['infer'], question: 'What evidence establishes leadershipChanges?',
    }]);
  });

  it('continues staged decision reasoning when GLM proposes an unsupported context value', async () => {
    const result = await runStagedFrozenDecisionDetailed(
      {...frozen, opportunity: {...frozen.opportunity, id: 'unsupported-resolution-evidence'}},
      new UnsupportedResolutionEvidenceModel(),
    );
    expect(result.trace.resolutions.find(resolution => resolution.field === 'leadershipChanges')).toMatchObject({
      status: 'OPEN', value: null, claimIds: [], question: 'What evidence establishes leadershipChanges?',
    });
    expect(result.decision.verdict).toBe('PASS');
  });

  it('rejects a question on a resolved field before decision reasoning', async () => {
    await expect(runStagedFrozenDecisionDetailed(frozen, new ResolvedQuestionModel()))
      .rejects.toThrow(`Resolved field cannot carry a question: ${contextFields[0]}`);
  });

  it('rejects executive distance without reporting topology for an ordinary role', async () => {
    class UnsupportedDistanceModel extends ScriptedModel {
      async generate(instruction:string,input:any){
        if(instruction.startsWith('Resolve only RADAR')){
          return {
            resolutions: openResolutions.map(resolution =>
              resolution.field === 'executiveDistance'
                ? {...resolution,status:'INFERRED',value:3,claimIds:['JD-1'],methods:['infer'],question:undefined}
                : resolution
            ),
          };
        }
        return super.generate(instruction,input);
      }
    }
    await expect(runStagedFrozenDecisionDetailed(
      {...frozen,opportunity:{...frozen.opportunity,id:'unsupported-executive-distance'}},
      new UnsupportedDistanceModel(),
    )).rejects.toThrow('Executive distance requires reporting topology unless explicit founder/CxO authority independently establishes executive altitude');
  });

  it('allows executive distance from explicit CxO altitude even when a conventional reporting line is unknown', async () => {
    const cxoClaim:Claim={
      id:'JD-3',
      text:'The role title is Chief Marketing Officer (CMO).',
      state:'EXPLICIT',
      confidence:1,
      plane:'JD',
      citations:[{sourceId:'JD-SOURCE',quote:'Chief Marketing Officer (CMO)'}],
      derivedFrom:[],
    };
    class CxoDistanceModel extends ScriptedModel {
      async generate(instruction:string,input:any){
        if(instruction.startsWith('Resolve only RADAR')){
          return {
            resolutions: openResolutions.map(resolution =>
              resolution.field === 'executiveDistance'
                ? {...resolution,status:'INFERRED',value:1,claimIds:['JD-3'],methods:['infer'],question:undefined}
                : resolution
            ),
          };
        }
        return super.generate(instruction,input);
      }
    }
    const result=await runStagedFrozenDecisionDetailed({
      ...frozen,
      opportunity:{...frozen.opportunity,id:'cxo-executive-distance'},
      evidence:[...claims,cxoClaim],
      validEvidenceClaimIds:[...claims.map(claim=>claim.id),cxoClaim.id],
    },new CxoDistanceModel());
    expect(result.trace.resolutions.find(resolution=>resolution.field==='reportingLine')?.status).toBe('OPEN');
    expect(result.trace.resolutions.find(resolution=>resolution.field==='executiveDistance')).toMatchObject({
      status:'INFERRED',
      value:1,
      claimIds:['JD-3'],
    });
  });

  it('requires analytical leadership mode classifications to be inferred', async () => {
    await expect(runStagedFrozenDecisionDetailed(frozen, new ResolvedLeadershipModeModel()))
      .rejects.toThrow('leadershipMode is an analytical classification; label it INFERRED unless the source uses the classification itself');
  });
});
