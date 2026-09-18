import { describe,expect,it,vi } from 'vitest';
import Database from 'better-sqlite3';
import {GoogleAuth} from 'google-auth-library';
import {adcTokenProvider} from '../../src/lib/model/google-adc';
import {SqliteAdapter} from '../../src/data/database/sqlite';
import {setupLineageTestFixture} from '../persistence/lineage_fixture';
import {durableDossierModel} from '../../src/lib/intelligence/staged/DurableDossierModel';
import {dossier as fixtureDossier,stagedEvaluation} from '../fixtures/staged-rich-dossier';
import {compositionSchema} from '../../src/dossier/contracts';
import {propose} from '../../src/dossier/evidence';
import {assertFactualReviewProvenance} from '../../src/dossier/factual-review-integrity';
import { bindStagedEditorial,composeStagedDossier,reviewStagedEditorialAction,reviewStagedEditorialFacts } from '../../src/dossier/staged-composition';
import { runStagedFrozenDecisionDetailed } from '../../src/dossier/staged-decision';
import { ModelProviderUnavailableError,providerRetryAfterMs } from '../../src/lib/model/provider-unavailable';
import { createGeminiFactualReviewModel } from '../../src/lib/model/gemini-factual-review-model';
import type { StagedResearchInput } from '../../src/dossier/staged-role';
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
  it('carries earlier repair constraints forward instead of oscillating between defects',async()=>{
    let calls=0;
    const model={id:'cumulative-repair',version:'1',async generate(_instruction:string,input:any){
      calls++;if(calls===3){expect(input.repair).toContain('unsupported premise');expect(input.repair).toContain('missing qualification');}
      return {attempt:calls};
    }};
    expect(await propose(model,'memo',{},(value:any)=>{if(value.attempt===1)throw new Error('unsupported premise');if(value.attempt===2)throw new Error('missing qualification');return value;})).toEqual({attempt:3});
  });
  it('uses short transient backoff and preserves explicit provider retry metadata',async()=>{
    expect(new ModelProviderUnavailableError('Throttle',429).retryAfterMs).toBe(30_000);
    expect(new ModelProviderUnavailableError('Capacity',503).retryAfterMs).toBe(30_000);
    expect(new ModelProviderUnavailableError('Auth',403).retryAfterMs).toBe(900_000);
    const now=Date.parse('2026-09-19T00:00:00Z');
    expect(await providerRetryAfterMs(new Response('',{headers:{'Retry-After':'Sat, 19 Sep 2026 00:02:00 GMT'}}),now)).toBe(120_000);
    expect(await providerRetryAfterMs(new Response('not JSON',{headers:{'Retry-After':'invalid'}}),now)).toBeUndefined();
    expect(await providerRetryAfterMs(new Response(JSON.stringify({error:{details:[{'@type':'type.googleapis.com/google.rpc.RetryInfo',retryDelay:'45.5s'}]}})))).toBe(45_500);
  });
  it('passes a Gemini quota hint through the reviewer boundary without repeated calls or leaking the body',async()=>{
    let calls=0;
    const reviewer=createGeminiFactualReviewModel({projectId:'test-project',token:async()=>'secret',request:async()=>{calls++;return new Response('private provider body',{status:429,headers:{'Retry-After':'90'}});}});
    const error=await reviewer.generate('review',{}).catch(error=>error);
    expect(error).toBeInstanceOf(ModelProviderUnavailableError);
    expect(error.httpStatus).toBe(429);expect(error.retryAfterMs).toBe(90_000);expect(calls).toBe(1);
    expect(error.message).not.toContain('private provider body');
  });
  it.each(['TimeoutError','network'])('uses a short durable delay for %s without a status code',async mode=>{
    const reviewer=createGeminiFactualReviewModel({projectId:'test-project',token:async()=>'secret',request:async()=>{throw mode==='TimeoutError'?new DOMException('provider timeout','TimeoutError'):new TypeError('fetch failed');}});
    const error=await reviewer.generate('review',{}).catch(error=>error);
    expect(error).toBeInstanceOf(ModelProviderUnavailableError);
    expect(error.retryAfterMs).toBe(30_000);
  });
  it('does not trap a resumed composition in rejected cached proposals',async()=>{
    const db=new SqliteAdapter(new Database(':memory:'));await setupLineageTestFixture(db);
    let valid=false,calls=0;
    const model=durableDossierModel(db,'proposal-retry',{id:'repairable-proposal',version:'1',async generate(){calls++;return {valid};}});
    const validate=(value:any)=>{if(!value.valid)throw new Error('Invalid proposal');return value;};
    await expect(propose(model,'compose',{},validate)).rejects.toThrow('Invalid proposal');
    expect((await db.one<{n:number}>('SELECT COUNT(*) n FROM dossier_model_checkpoints'))!.n).toBeGreaterThan(0);
    const beforeResume=calls;
    valid=true;expect(await propose(model,'compose',{},validate)).toEqual({valid:true});
    expect(calls).toBe(beforeResume+1);
  });
  it('never composes from the last rejected plan and includes it in bounded repairs',async()=>{
    const proposal={...editorial,narrativePlan:{...editorial.narrativePlan,memoPoints:fixtureDossier().narrativePlan.memoPoints!.filter(p=>p.section==='candidateFit')}};
    let calls=0;const stages:string[]=[];
    const model={id:'invalid-plan',version:'1',discardResponse:vi.fn(),async generate(_instruction:string,input:any){
      if(calls++)expect(input.previous).toEqual(proposal);
      return proposal;
    }};
    const reviewer={id:'unused-review',version:'1',generate:vi.fn()};
    await expect(composeStagedDossier(frozen,stagedEvaluation,model,reviewer,s=>stages.push(s))).rejects.toThrow('STAGED_EDITORIAL_FAILED: MEMO_PLAN_DECISION_COVERAGE');
    expect(calls).toBe(3);expect(stages.some(s=>s.startsWith('Composing'))).toBe(false);
    expect(model.discardResponse).toHaveBeenCalledExactlyOnceWith(proposal);
    expect(reviewer.generate).not.toHaveBeenCalled();
  });
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
    expect(request.factualReview).not.toHaveProperty('availableEvidence');
  });
  it('repairs malformed reviewer coverage without rewriting the section',async()=>{
    let calls=0;
    const model={id:'review-repair',version:'1',async generate(_instruction:string,input:any){
      calls++;if(calls===1)return {reviews:[]};
      expect(input.reviewRepair).toContain('INCOMPLETE');
      return {reviews:input.factualReview.passages.map((p:any)=>({passageId:p.passageId,externalComparison:'NONE',candidateAbsence:'NONE',factualAssessment:'Supported.',supported:true,issue:''}))};
    }};
    const receipt=await reviewStagedEditorialFacts(model,frozen,'executiveThesis',{executiveThesis:factualPassage});
    expect(receipt.accepted).toBe(true);expect(calls).toBe(2);
  });
  it('does not permanently cache malformed reviewer coverage across retries',async()=>{
    const db=new SqliteAdapter(new Database(':memory:'));await setupLineageTestFixture(db);
    let broken=true,calls=0;
    const model={id:'recover-review',version:'1',async generate(_instruction:string,input:any){
      calls++;return {reviews:broken?[]:input.factualReview.passages.map((p:any)=>({passageId:p.passageId,externalComparison:'NONE',candidateAbsence:'NONE',factualAssessment:'Supported.',supported:true,issue:''}))};
    }};
    await expect(reviewStagedEditorialFacts(durableDossierModel(db,'review-scope',model),frozen,'executiveThesis',{executiveThesis:factualPassage})).rejects.toThrow('EDITORIAL_FACT_REVIEW_INVALID');
    expect(calls).toBe(3);expect(await db.one('SELECT COUNT(*) n FROM dossier_model_checkpoints')).toEqual({n:0});
    broken=false;
    expect((await reviewStagedEditorialFacts(durableDossierModel(db,'review-scope',model),frozen,'executiveThesis',{executiveThesis:factualPassage})).accepted).toBe(true);
    expect(calls).toBe(4);
  });
  it('keeps unrelated evidence out of each review while retaining cited ancestry',async()=>{
    const expanded={...frozen,evidence:[...frozen.evidence,...Array.from({length:200},(_,i)=>({...frozen.evidence[0],id:`unrelated-${i}`,text:'Unrelated company evidence '.repeat(50)}))]};
    const model={id:'scoped-review',version:'1',async generate(_instruction:string,input:any){
      expect(input.factualReview.claims).toHaveLength(2);
      expect(JSON.stringify(input).length).toBeLessThan(4000);
      return {reviews:input.factualReview.passages.map((p:any)=>({passageId:p.passageId,externalComparison:'NONE',candidateAbsence:'NONE',factualAssessment:'Supported.',supported:true,issue:''}))};
    }};
    await reviewStagedEditorialFacts(model,expanded,'executiveThesis',{executiveThesis:factualPassage});
  });
  it('uses standard ADC credentials and coalesces simultaneous token requests',async()=>{
    const auth=new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']});
    expect(auth.fromJSON({type:'authorized_user',client_id:'test',client_secret:'test',refresh_token:'test'}).constructor.name).toBe('UserRefreshClient');
    expect(auth.fromJSON({type:'service_account',client_email:'test@example.iam.gserviceaccount.com',private_key:'fixture-not-used-for-signing'}).constructor.name).toBe('JWT');
    expect(auth.fromJSON({type:'external_account',audience:'//iam.googleapis.com/projects/123/locations/global/workloadIdentityPools/test/providers/test',subject_token_type:'urn:ietf:params:oauth:token-type:jwt',token_url:'https://sts.googleapis.com/v1/token',credential_source:{file:'fixture-not-read'}}).constructor.name).toBe('IdentityPoolClient');
    const getAccessToken=vi.fn(async()=>'test-token');const token=adcTokenProvider({getAccessToken});
    expect(await Promise.all([token(),token(),token()])).toEqual(['test-token','test-token','test-token']);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    await expect(adcTokenProvider({getAccessToken:async()=>{throw new Error('private credential contents');}})()).rejects.toThrow('Google ADC authentication unavailable');
  });
  it('resumes an interrupted composition using durable proposals and reviews in a fresh module instance',async()=>{
    const db=new SqliteAdapter(new Database(':memory:'));await setupLineageTestFixture(db);
    const seed=fixtureDossier();
    const input:StagedResearchInput={...frozen,opportunity:seed.opportunity,candidate:seed.candidate,evidence:seed.evidence.roleClaims,sources:seed.evidence.lineage,candidateSourceRefs:[],validEvidenceClaimIds:['JD-1-1']};
    let generated=0,reviews=0,fail=true;
    const model={id:'restart-composer',version:'1',async generate(instruction:string){
      generated++;
      if(instruction.includes('Return only rationale and narrativePlan'))return {rationale:seed.verdict.rationale,narrativePlan:seed.narrativePlan};
      if(instruction.includes('Review only whether'))return {aligned:true,issue:''};
      const key=instruction.match(/ONLY the top-level key (\w+)/)![1] as keyof typeof compositionSchema.shape;
      return {[key]:seed[key]};
    }};
    const reviewer={id:'restart-reviewer',version:'1',async generate(_instruction:string,request:any){
      reviews++;if(fail&&reviews===4)throw new ModelProviderUnavailableError('HTTP 429',429);
      return {coveredPointIds:request.memo.assignedPoints.map((p:any)=>p.id),editorialIssues:[],reviews:request.factualReview.passages.map((p:any)=>({passageId:p.passageId,externalComparison:'NONE',candidateAbsence:'NONE',factualAssessment:'Supported by fixture.',supported:true,issue:''}))};
    }};
    await expect(composeStagedDossier(input,stagedEvaluation,durableDossierModel(db,'scope',model),durableDossierModel(db,'scope',reviewer))).rejects.toThrow('HTTP 429');
    const callsBefore=generated;
    const saved=await db.one<{n:number}>('SELECT COUNT(*) n FROM dossier_model_checkpoints');expect(saved!.n).toBeGreaterThan(7);
    fail=false;
    // Clear process-local proposal caches to simulate a restart; DB remains.
    vi.resetModules();const resumed=await import('../../src/dossier/staged-composition');
    const result=await resumed.composeStagedDossier(input,stagedEvaluation,durableDossierModel(db,'scope',model),durableDossierModel(db,'scope',reviewer));
    assertFactualReviewProvenance(result);
    expect(reviews).toBe(7); // six sections plus the interrupted request
    expect(generated-callsBefore).toBeLessThanOrEqual(3);
    const request={a:1};const provider=vi.fn(async()=>({ok:true}));
    await durableDossierModel(db,'different-scope',{id:'x',version:'1',generate:provider}).generate('instruction',request);
    await durableDossierModel(db,'different-scope',{id:'x',version:'2',generate:provider}).generate('instruction',request);
    expect(provider).toHaveBeenCalledTimes(2);
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
