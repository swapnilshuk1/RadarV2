import { describe,expect,it } from 'vitest';
import { bindStagedEditorial } from '../../src/dossier/staged-composition';
import type { StagedResearchInput } from '../../src/dossier/staged-research';
import type { StagedDecisionResult } from '../../src/dossier/staged-decision-contract';

const frozen:StagedResearchInput={opportunity:{id:'job',company:'Company',title:'Head'},candidate:{name:'Candidate'},
  sources:[{id:'jd',plane:'JD',title:'JD',locator:'jd',text:'Lead growth.',capturedAt:'2026-01-01'},{id:'cv',plane:'CANDIDATE',title:'CV',locator:'cv',text:'Led growth.',capturedAt:'2026-01-01'}],
  evidence:[{id:'JD-1-1',text:'Lead growth.',plane:'JD',state:'EXPLICIT',confidence:1,citations:[{sourceId:'jd',quote:'Lead growth.'}],derivedFrom:[]},{id:'CANDIDATE-1-1',text:'Led growth.',plane:'CANDIDATE',state:'EXPLICIT',confidence:1,citations:[{sourceId:'cv',quote:'Led growth.'}],derivedFrom:[]}],
  candidateSourceRefs:[],candidateConflicts:[],acquisition:[],validEvidenceClaimIds:['JD-1-1','CANDIDATE-1-1'],fields:[],fingerprint:'input'};
const editorial={rationale:'Authority merits a deliberate career choice.',narrativePlan:{roleArchetype:'Growth',mandateShape:'Build',careerMove:'Lateral',authorityShape:'Function',fitShape:'Direct',evidenceShape:'Precedent',decisionTension:'Authority',companyTrajectory:'Unresolved',argument:'Assess authority before pursuing.',emphasis:['Authority'],sectionOrder:['executiveThesis'],claimIds:['JD-1-1','CANDIDATE-1-1']}};
const axis={material:false,candidateClaimIds:[],operatingConditionIds:[],resolutionFields:[]};
const decision:StagedDecisionResult['decision']={verdict:'PASS',screeningViability:'PLAUSIBLE',decisionHinges:[],reopeningConditions:[],screeningDriverRequirementIds:[],careerCapital:{authority:axis,scope:axis,functionalAltitude:axis,compensation:axis}};
const staged:StagedDecisionResult={decision,trace:{decision,role:{requirements:[],operatingConditions:[],authorityShape:'Function',roleSideConditions:[]},requirements:[{id:'REQ-001',requirement:'Growth capability',strength:'PREFERRED',roleImportance:'CORE_CAPABILITY',roleClaimIds:['JD-1-1'],reasoning:'Delivery',screeningGate:false,screeningFunction:'ROLE_PERFORMANCE_REQUIREMENT',screeningGateBasis:'NONE',screeningReasoning:'Performance',status:'DIRECT',candidateClaimIds:['CANDIDATE-1-1'],unsupportedAspects:[],mappingReasoning:'Direct growth precedent'}],resolutions:[{field:'authority',status:'OPEN',value:null,claimIds:[],methods:['ask'],question:'What authority?',consequence:'Changes career value.'}],eligibleScreeningDrivers:[],screeningConstraint:'NONE'}};

describe('staged dossier editorial boundary',()=>{
  it('preserves verdict, viability, mapping and screening roles while adding narrative',()=>{
    const result=bindStagedEditorial(frozen,staged,editorial);
    expect(result.evaluation.verdict).toBe('PASS');
    expect(result.evaluation.screeningViability).toBe('PLAUSIBLE');
    expect(result.evaluation.requirements[0]).toMatchObject({mandatory:false,decisionRole:'PREFERENCE',status:'DIRECT',candidateClaimIds:['CANDIDATE-1-1']});
  });
  it('rejects an editorial attempt to author the verdict',()=>{
    expect(()=>bindStagedEditorial(frozen,staged,{...editorial,verdict:'PURSUE'})).toThrow();
  });
  it('rejects fabricated evidence IDs',()=>{
    expect(()=>bindStagedEditorial(frozen,staged,{...editorial,narrativePlan:{...editorial.narrativePlan,claimIds:['INVENTED']}})).toThrow('EDITORIAL_CLAIM_PROVENANCE_INVALID');
  });
});
