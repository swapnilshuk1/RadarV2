import { describe,expect,it } from 'vitest';
import { bindStagedEditorial,composeStagedDossier } from '../../src/dossier/staged-composition';
import { runStagedFrozenDecisionDetailed } from '../../src/dossier/staged-decision';
import { ModelProviderUnavailableError } from '../../src/lib/model/provider-unavailable';
import type { StagedResearchInput } from '../../src/dossier/staged-research';
import { parseCanonicalStagedDecisionResult } from '../../src/dossier/staged-decision-integrity';

const frozen:StagedResearchInput={opportunity:{id:'job',company:'Company',title:'Head'},candidate:{name:'Candidate'},
  sources:[{id:'jd',plane:'JD',title:'JD',locator:'jd',text:'Lead growth.',capturedAt:'2026-01-01'},{id:'cv',plane:'CANDIDATE',title:'CV',locator:'cv',text:'Led growth.',capturedAt:'2026-01-01'}],
  evidence:[{id:'JD-1-1',text:'Lead growth.',plane:'JD',state:'EXPLICIT',confidence:1,citations:[{sourceId:'jd',quote:'Lead growth.'}],derivedFrom:[]},{id:'CANDIDATE-1-1',text:'Led growth.',plane:'CANDIDATE',state:'EXPLICIT',confidence:1,citations:[{sourceId:'cv',quote:'Led growth.'}],derivedFrom:[]}],
  candidateSourceRefs:[],candidateConflicts:[],acquisition:[],validEvidenceClaimIds:['JD-1-1','CANDIDATE-1-1'],fields:[],fingerprint:'input'};
const editorial={rationale:'Authority merits a deliberate career choice.',narrativePlan:{roleArchetype:'Growth',mandateShape:'Build',careerMove:'Lateral',authorityShape:'Function',fitShape:'Direct',evidenceShape:'Precedent',decisionTension:'Authority',companyTrajectory:'Unresolved',argument:'Assess authority before pursuing.',emphasis:['Authority'],sectionOrder:['executiveThesis'],claimIds:['JD-1-1','CANDIDATE-1-1']}};
const axis={material:false,candidateClaimIds:[],operatingConditionIds:[],resolutionFields:[]};
const decision={verdict:'PASS',screeningViability:'PLAUSIBLE',decisionHinges:[{requirementIds:[],resolutionFields:['authority']}],reopeningConditions:[],screeningDriverRequirementIds:[],careerCapital:{authority:axis,scope:axis,functionalAltitude:axis,compensation:axis}} as const;
const staged=parseCanonicalStagedDecisionResult({decision,trace:{decision,role:{requirements:[{id:'REQ-001',requirement:'Growth capability',strength:'PREFERRED',roleImportance:'CORE_CAPABILITY',roleClaimIds:['JD-1-1'],reasoning:'Delivery'}],operatingConditions:[],authorityShape:'Function',roleSideConditions:[]},requirements:[{id:'REQ-001',requirement:'Growth capability',strength:'PREFERRED',roleImportance:'CORE_CAPABILITY',roleClaimIds:['JD-1-1'],reasoning:'Delivery',screeningGate:false,screeningFunction:'ROLE_PERFORMANCE_REQUIREMENT',screeningGateBasis:'NONE',screeningSupportQuoteIds:['REQ-001:Q1'],screeningReasoning:'Performance',status:'DIRECT',candidateClaimIds:['CANDIDATE-1-1'],unsupportedAspects:[],mappingReasoning:'Direct growth precedent'}],resolutions:[{field:'authority',status:'OPEN',value:null,claimIds:[],methods:['ask'],question:'What authority?',consequence:'Changes career value.'}],eligibleScreeningDrivers:[],screeningConstraint:'NONE'}});

describe('staged dossier editorial boundary',()=>{
  it.each(['evaluation','composition'])('stops %s without semantic repairs on provider failure',async phase=>{
    let calls=0;const error=new ModelProviderUnavailableError('Bedrock provider HTTP 403',403);
    const model={id:'provider-failure-test',version:phase,async generate(){calls++;throw error;}};
    await expect(phase==='evaluation'?runStagedFrozenDecisionDetailed(frozen,model):composeStagedDossier(frozen,staged,model)).rejects.toBe(error);
    expect(calls).toBe(1);
  });
  it('preserves verdict, viability, mapping and screening roles while adding narrative',()=>{
    const result=bindStagedEditorial(frozen,staged,editorial);
    expect(result.evaluation.verdict).toBe('PASS');
    expect(result.evaluation.screeningViability).toBe('PLAUSIBLE');
    expect(result.evaluation.requirements[0]).toMatchObject({mandatory:false,decisionRole:'PREFERENCE',status:'DIRECT',candidateClaimIds:['CANDIDATE-1-1']});
    expect(staged.trace.requirements[0]).toMatchObject({id:'REQ-001',screeningFunction:'ROLE_PERFORMANCE_REQUIREMENT',screeningGateBasis:'NONE',screeningSupportQuoteIds:['REQ-001:Q1'],mappingReasoning:'Direct growth precedent'});
  });
  it('rejects a persisted staged result whose headline and trace decision diverge',()=>{
    expect(()=>parseCanonicalStagedDecisionResult({...staged,decision:{...staged.decision,verdict:'PURSUE'}})).toThrow('STAGED_EVALUATION_DECISION_TRACE_MISMATCH');
  });
  it('rejects a persisted screening gate that disagrees with deterministic derivation',()=>{
    const invalid:any=structuredClone(staged);
    invalid.trace.requirements[0].screeningGate=true;
    expect(()=>parseCanonicalStagedDecisionResult(invalid)).toThrow('STAGED_EVALUATION_SCREENING_GATE_DERIVATION_MISMATCH');
  });
  it('rejects omission of an unresolved application-derived screening driver',()=>{
    const invalid:any=structuredClone(staged);
    const requirement=invalid.trace.requirements[0];
    requirement.strength='REQUIRED';
    requirement.screeningGate=true;
    requirement.screeningFunction='ENTRY_QUALIFICATION';
    requirement.screeningGateBasis='PRIOR_RELEVANT_EXPERIENCE';
    requirement.status='NOT_EVIDENCED';
    requirement.candidateClaimIds=[];
    requirement.unsupportedAspects=['Growth capability'];
    expect(()=>parseCanonicalStagedDecisionResult(invalid)).toThrow('STAGED_EVALUATION_SCREENING_DRIVER_DERIVATION_MISMATCH');
  });
  it('replays decision policy rather than trusting a structurally valid persisted verdict',()=>{
    const invalid:any=structuredClone(staged);
    invalid.decision.screeningViability='BLOCKED';
    invalid.trace.decision.screeningViability='BLOCKED';
    // The invariant under test is rejection after deterministic policy replay.
    // Do not couple this regression to the ordering or wording of policy errors.
    expect(()=>parseCanonicalStagedDecisionResult(invalid)).toThrow();
  });
  it('rejects an editorial attempt to author the verdict',()=>{
    expect(()=>bindStagedEditorial(frozen,staged,{...editorial,verdict:'PURSUE'})).toThrow();
  });
  it('rejects fabricated evidence IDs',()=>{
    expect(()=>bindStagedEditorial(frozen,staged,{...editorial,narrativePlan:{...editorial.narrativePlan,claimIds:['INVENTED']}})).toThrow('EDITORIAL_CLAIM_PROVENANCE_INVALID');
  });
});
