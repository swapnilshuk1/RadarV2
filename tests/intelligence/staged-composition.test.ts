import { describe,expect,it } from 'vitest';
import { bindStagedEditorial,composeStagedDossier,reviewStagedEditorialAction,reviewStagedEditorialFacts } from '../../src/dossier/staged-composition';
import { runStagedFrozenDecisionDetailed } from '../../src/dossier/staged-decision';
import { ModelProviderUnavailableError } from '../../src/lib/model/provider-unavailable';
import { createGeminiFactualReviewModel } from '../../src/lib/model/gemini-factual-review-model';
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
  it('pauses on reviewer infrastructure failure without exposing provider bodies',async()=>{
    const reviewer=createGeminiFactualReviewModel({projectId:'test-project',token:async()=>'private-token',request:async(_url,options)=>{expect(JSON.parse(options!.body as string).generationConfig.thinkingConfig).toEqual({thinkingLevel:'MEDIUM'});return new Response('sensitive provider response',{status:403});}});
    expect(reviewer.version).toBe('gemini-3.8-flash');
    const error=await reviewer.generate('review',{}).catch(error=>error);
    expect(error).toBeInstanceOf(ModelProviderUnavailableError);
    expect(error.httpStatus).toBe(403);
    expect(error.message).not.toContain('sensitive');expect(error.message).not.toContain('private-token');
  });
  it.each(['MAX_TOKENS','INVALID_JSON'])('does not turn %s reviewer output into prose repair',async mode=>{
    const reviewer=createGeminiFactualReviewModel({projectId:'test-project',token:async()=>'private-token',request:async()=>new Response(JSON.stringify({candidates:[{finishReason:mode==='MAX_TOKENS'?'MAX_TOKENS':'STOP',content:{parts:[{text:'incomplete JSON'}]}}]}))});
    await expect(reviewer.generate('review',{})).rejects.toThrow('GEMINI_REVIEW_OUTPUT_INCOMPLETE');
    await expect(reviewer.generate('review',{})).rejects.toBeInstanceOf(ModelProviderUnavailableError);
  });
  const factualPassage={text:'Your growth precedent supports this mandate.',kind:'CONCLUSION',state:'INFERRED',confidence:0.8,sourcePlane:'RELATIONAL',evidenceRefs:['JD-1-1','CANDIDATE-1-1'],reasoning:'Candidate growth experience is relevant to the mandate.'};
  it('sends standard JSON Schema to an independent reviewer and preserves provider failures',async()=>{
    const failure=new ModelProviderUnavailableError('Reviewer unavailable');
    let calls=0;
    const model={id:'vertex-gemini',version:'gemini-3.8-flash',schemaFormat:'json-schema' as const,async generate(_instruction:string,_input:unknown,schema?:Record<string,unknown>){calls++;expect(schema?.type).toBe('object');throw failure;}};
    await expect(reviewStagedEditorialFacts(model,frozen,'executiveThesis',{executiveThesis:factualPassage})).rejects.toBe(failure);
    expect(calls).toBe(1);
  });
  it('reviews cited evidence while keeping decision authority outside factual review',async()=>{
    let request:any;
    const model={id:'fact-test',version:'1',async generate(_instruction:string,input:unknown){request=input;return {reviews:[{passageId:'P1:S1',externalComparison:'NONE',candidateAbsence:'NONE',factualAssessment:'Compared the assertion with the supplied evidence.',supported:true,issue:''}]};}};
    await reviewStagedEditorialFacts(model,frozen,'executiveThesis',{executiveThesis:factualPassage});
    expect(request.factualReview.claims.map((c:any)=>c.id)).toEqual(['JD-1-1','CANDIDATE-1-1']);
    expect(request.factualReview.sources.map((s:any)=>s.id)).toEqual(['jd','cv']);
    expect(request).not.toHaveProperty('staged');expect(request).not.toHaveProperty('decision');
  });
  it.each([
    {reviews:[]},
    {reviews:[{passageId:'invented',externalComparison:'NONE',candidateAbsence:'NONE',factualAssessment:'Unknown passage.',supported:true,issue:''}]},
    {reviews:[{passageId:'P1:S1',externalComparison:'NONE',candidateAbsence:'NONE',factualAssessment:'Compared the assertion with the supplied evidence.',supported:true,issue:''},{passageId:'P1:S1',externalComparison:'NONE',candidateAbsence:'NONE',factualAssessment:'Compared the assertion with the supplied evidence.',supported:true,issue:''}]},
    {reviews:[{passageId:'P1:S1',externalComparison:'NONE',candidateAbsence:'NONE',factualAssessment:'Compared the assertion with the supplied evidence.',supported:false,issue:''}]},
  ])('fails closed on incomplete or contradictory factual-review coverage',async response=>{
    const model={id:'invalid-fact-test',version:'1',async generate(){return response;}};
    await expect(reviewStagedEditorialFacts(model,frozen,'executiveThesis',{executiveThesis:factualPassage})).rejects.toThrow('EDITORIAL_FACT_REVIEW_');
  });
  it('routes unsupported factual assertions into bounded section repair without changing evidence',async()=>{
    const before=structuredClone(frozen);
    const model={id:'fact-defect-test',version:'1',async generate(){return {reviews:[{passageId:'P1:S1',externalComparison:'NONE',candidateAbsence:'NONE',factualAssessment:'Compared the assertion with the supplied evidence.',supported:false,issue:'The cited evidence does not establish this reporting relationship.'}]};}};
    await expect(reviewStagedEditorialFacts(model,frozen,'executiveThesis',{executiveThesis:factualPassage})).rejects.toThrow('EDITORIAL_FACT_SUPPORT: P1:S1:');
    expect(frozen).toEqual(before);
  });
  it('requires every sentence and rejects an unsupported boundary despite an overall approval',async()=>{
    const model={id:'boundary-test',version:'1',async generate(_instruction:string,input:any){
      expect(input.factualReview.passages.map((p:any)=>p.passageId)).toEqual(['P1:S1','P1:S2']);
      return {reviews:input.factualReview.passages.map((p:any)=>({passageId:p.passageId,externalComparison:p.passageId==='P1:S2'?'UNSUPPORTED':'NONE',candidateAbsence:'NONE',factualAssessment:'The second sentence asserts a baseline absent from the cited evidence.',supported:true,issue:''}))};
    }};
    await expect(reviewStagedEditorialFacts(model,frozen,'executiveThesis',{executiveThesis:{...factualPassage,text:'Your growth precedent is relevant. The salary exceeds industry benchmarks.'}})).rejects.toThrow('EDITORIAL_FACT_SUPPORT: P1:S2:');
  });
  it('keeps action codes in the application verdict instead of admitting a competing prose label',async()=>{
    let calls=0;const model={id:'action-label-boundary',version:'1',async generate(){calls++;return {aligned:true,issue:''};}};
    await expect(reviewStagedEditorialAction(model,'CONSIDER','executiveThesis',{executiveThesis:{text:'PASS for now; investigate later.',kind:'ADVICE',state:'INFERRED',confidence:0.8,sourcePlane:'JD',evidenceRefs:['JD-1-1'],reasoning:'Fixture'}})).rejects.toThrow('Action labels belong');
    expect(calls).toBe(0);
  });
  it('limits editorial action review to the fixed action without reopening evaluation axes',async()=>{
    let payload:any;
    const model={id:'review-boundary',version:'1',async generate(_instruction:string,input:unknown){payload=input;return {aligned:true,issue:''};}};
    await reviewStagedEditorialAction(model,'CONSIDER','executiveThesis',{text:'Investigate the mandate before committing.'});
    expect(payload.fixedAction).toEqual({verdict:'CONSIDER',action:'INVESTIGATE_BEFORE_COMMITTING'});
    expect(payload).not.toHaveProperty('decision');
    expect(payload.fixedAction).not.toHaveProperty('screeningViability');
    expect(payload.fixedAction).not.toHaveProperty('careerCapital');
  });
  it.each(['evaluation','composition'])('stops %s without semantic repairs on provider failure',async phase=>{
    let calls=0;const error=new ModelProviderUnavailableError('Bedrock provider HTTP 403',403);
    const model={id:'provider-failure-test',version:phase,async generate(){calls++;throw error;}};
    await expect(phase==='evaluation'?runStagedFrozenDecisionDetailed(frozen,model):composeStagedDossier(frozen,staged,model,model)).rejects.toBe(error);
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
