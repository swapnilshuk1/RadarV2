import type {Dossier,JsonValue,Passage} from '../../src/dossier/contracts';
import {createStagedEvaluationFingerprint,parseCanonicalStagedDecisionResult} from '../../src/dossier/staged-decision-integrity';
const axis={material:false,candidateClaimIds:[],operatingConditionIds:[],resolutionFields:[]};
export const stagedEvaluation=parseCanonicalStagedDecisionResult({
  decision:{
    verdict:'PURSUE',screeningViability:'PLAUSIBLE',
    decisionHinges:[{requirementIds:['REQ-001'],resolutionFields:[]}],
    reopeningConditions:[{requirementIds:['REQ-001']}],
    screeningDriverRequirementIds:[],
    careerCapital:{authority:axis,scope:axis,functionalAltitude:axis,compensation:axis},
  },
  trace:{
    role:{
      requirements:[{id:'REQ-001',requirement:'Growth',strength:'REQUIRED',roleImportance:'CORE_CAPABILITY',roleClaimIds:['JD-1-1'],reasoning:'Growth is core to the mandate.'}],
      operatingConditions:[],authorityShape:'Function',roleSideConditions:[],
    },
    requirements:[{
      id:'REQ-001',requirement:'Growth',strength:'REQUIRED',roleImportance:'CORE_CAPABILITY',roleClaimIds:['JD-1-1'],reasoning:'Growth is core to the mandate.',
      screeningGate:false,screeningFunction:'ROLE_PERFORMANCE_REQUIREMENT',screeningGateBasis:'NONE',screeningSupportQuoteIds:['REQ-001:Q1'],screeningReasoning:'The source describes role performance, not an entry gate.',
      status:'NOT_EVIDENCED',candidateClaimIds:[],unsupportedAspects:['direct growth precedent'],mappingReasoning:'The supplied candidate evidence does not directly establish this requirement.',
    }],
    resolutions:[{field:'reportingLine',status:'OPEN',value:null,claimIds:[],methods:['ask'],question:'Who owns the growth mandate?',consequence:'Authority changes the career value.'}],eligibleScreeningDrivers:[],screeningConstraint:'NONE',
    decision:{
      verdict:'PURSUE',screeningViability:'PLAUSIBLE',
      decisionHinges:[{requirementIds:['REQ-001'],resolutionFields:[]}],
      reopeningConditions:[{requirementIds:['REQ-001']}],
      screeningDriverRequirementIds:[],
      careerCapital:{authority:axis,scope:axis,functionalAltitude:axis,compensation:axis},
    },
  },
});
export const evaluationFingerprint=createStagedEvaluationFingerprint({evaluationContextFingerprint:'staged-context',inputFingerprint:'input',evaluation:stagedEvaluation});

export function dossier(trace:JsonValue=stagedEvaluation.trace as unknown as JsonValue):Dossier {
  const p=(text:string):Passage=>({text,kind:'ADVICE',state:'INFERRED',confidence:0.8,sourcePlane:'JD',evidenceRefs:['JD-1-1'],reasoning:'Derived from the supplied growth mandate.'});
  const list=(text:string)=>[p(text)];
  return {
    opportunity:{id:'job',company:'Company',title:'Head of Growth'},candidate:{name:'Candidate'},
    executiveThesis:p('Assess the growth mandate.'),roleInterest:list('Growth role'),strategicValue:list('Commercial value'),
    recommendation:{identityAlignment:list('Identity'),capabilityCoverage:list('Capability'),careerCapital:list('Career')},
    fit:{direct:[],adjacent:[],transferable:[],gaps:list('Validate the operating scope.')},
    mandate:{immediate:[],nearTerm:[],mediumTerm:[],outcomes:list('Growth outcomes')},successRequirements:list('Delivery'),
    candidatePositioning:{precedents:[],differentiators:[],evidence:list('Discuss evidence')},
    openQuestions:list('Clarify remit'),watchPoints:list('Execution risk'),decisionHinges:{strongerPursueIf:[],weakerIf:[],passIf:[]},
    conversationStrategy:{approach:list('Explore authority'),opening:[],questions:[],positioning:[],screening:[],interview:[],resumeNarrative:[],linkedinStrategy:[]},
    verdict:{verdict:'PURSUE',screeningViability:'PLAUSIBLE',rationale:'Growth mandate',claimIds:['JD-1-1'],requirements:[{requirement:'Growth',mandatory:true,decisionRole:'CORE_CAPABILITY',status:'NOT_EVIDENCED',roleClaimIds:['JD-1-1'],candidateClaimIds:[],reasoning:'Confirm proof'}]},
    narrativePlan:{roleArchetype:'Growth',mandateShape:'Build',careerMove:'Growth',authorityShape:'Function',fitShape:'Transferable',evidenceShape:'Mandate',decisionTension:'Scope',companyTrajectory:'Unknown',argument:'Clarify authority',emphasis:['Scope'],sectionOrder:['executiveThesis'],claimIds:['JD-1-1']},
    resolutions:stagedEvaluation.trace.resolutions,candidateConflicts:[],evidence:{roleClaims:[{id:'JD-1-1',text:'Lead growth.',state:'EXPLICIT',confidence:1,plane:'JD',citations:[{sourceId:'jd',quote:'Lead growth.'}],derivedFrom:[]}],candidateClaims:[],contextualClaims:[],relationalClaims:[],lineage:[{id:'jd',plane:'JD',title:'JD',locator:'job',text:'Lead growth.',capturedAt:'2026-01-01T00:00:00.000Z',attribution:'JOB_POST'}]},
    generatedAt:'2026-01-01',generation:{model:'test',sourceFingerprint:'sources'},acquisition:[],canonicalDecisionTrace:trace,
    sourceInputFingerprint:'input',sourceEvaluationFingerprint:evaluationFingerprint,
  };
}
