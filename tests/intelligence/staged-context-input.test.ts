import Database from 'better-sqlite3';
import {createHash} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {SqliteAdapter} from '../../src/data/database/sqlite';
import {setupLineageTestFixture} from '../persistence/lineage_fixture';
import {normalizeCanonicalJobText,ProductionStagedInputAdapter} from '@/evaluation/staged-input';
import {ProductionContextProvider} from '@/evaluation/context-provider';
import {SqliteStagedEvaluationStore} from '../../src/data/sqlite/repositories/SqliteStagedEvaluationStore';
import {computeContentHash} from '../../src/lib/domain/canonical_identity';
import {contextFields,type ContextProvider,type EvidenceSource} from '../../src/dossier/contracts';
import * as pipeline from '../../src/dossier/evidence';
import {computeEvaluationContextFingerprint} from '@/evaluation/fingerprint';
import {CONTEXT_ACQUISITION_POLICY} from '@/evaluation/context-acquisition-policy';
import {canonicalNormalize,computeDeterministicHash} from '../../src/lib/ontology/compiler/OntologyCompiler';

describe('context-aware immutable production input',()=>{
 it('normalizes scraper noise before evidence extraction without changing the canonical raw hash',()=>{
  const raw='<style>.job { display:block; color:red; }</style>\nShow more\nHead of Growth\nOwn revenue growth.\nOwn revenue growth.';
  expect(normalizeCanonicalJobText(raw)).toBe('Head of Growth\nOwn revenue growth.');
 });
 let db:SqliteAdapter;
 const contextFingerprint=(snapshot='sps_A')=>computeEvaluationContextFingerprint({tenantId:'tenant_A',personId:'person_A',searchPlanSnapshotId:snapshot,ontologyVersion:'v1',ontologyFingerprint:'hash_ontology',policyVersion:'staged-v8',profileVersion:'profile'});
 const identity={tenantId:'tenant_A',personId:'person_A',canonicalJobId:'job',opportunityVersion:'version',evaluationContextFingerprint:contextFingerprint(),profileVersion:'profile'};
 const source:EvidenceSource={id:'ctx-1',plane:'CONTEXT',title:'Company announcement',locator:'https://company.example/news',text:'Company expanded its operations into two new markets.',capturedAt:'2026-01-01T00:00:00.000Z',attribution:'COMPANY_PUBLISHED'};
 const provider=():ContextProvider=>({id:'fixture-context',acquire:vi.fn(async()=>({sources:[source],attempts:contextFields.map(field=>({field,provider:'fixture-context',operation:'retrieve' as const,status:'ACQUIRED' as const,sourceIds:[source.id],detail:'Retrieved company announcement; resolve the requested field from evidence.'}))}))});
 const model=()=>({id:'fixture',version:'1',generate:vi.fn(async(_instruction:string,input:any)=>{
  if(input.candidateSources)return {candidateConflicts:[{topic:'Employment start date',sourceIds:input.candidateSources.map((s:EvidenceSource)=>s.id),question:'Which source has the correct start date?'}]};
  return {sourceIds:input.sources.map((s:EvidenceSource)=>s.id),reasoning:'The announcement identifies the same company and geography as the role.'};
 })});
 beforeEach(async()=>{
  vi.restoreAllMocks();db=new SqliteAdapter(new Database(':memory:'));await setupLineageTestFixture(db);
  const projection={
    profileVersion:'profile',
    attainedTitle:'SVP Growth',
    operatingLevel:{value:'STRATEGIC',confidence:1,evidenceIds:['candidate-fixture']},
    workNature:{value:'STRATEGIC_WORK',confidence:1,evidenceIds:['candidate-fixture']},
    decisionAuthority:{value:'ENTERPRISE',confidence:1,evidenceIds:['candidate-fixture']},
    commercialScope:{value:'ENTERPRISE',confidence:1,evidenceIds:['candidate-fixture']},
    yearsOfExperience:20,
    coreCapabilities:['GROWTH'],
    preferredLocations:['India'],
    preferredWorkModel:'ANY',
    executiveThemes:['growth'],
  };
  await db.execute(`INSERT INTO career_profiles(id,person_id,timeline,skills,projection_json) VALUES('profile-row','person_A','[]','[]',?)`,[JSON.stringify(projection)]);
  await db.execute(`UPDATE search_plan_snapshots SET payload_json=? WHERE id='sps_A'`,[JSON.stringify({customParameters:{candidateDecisionIntent:{targetTitles:['CMO'],preferredLocations:['India'],decisionPreferences:{careerMove:'PROGRESSION'}}}})]);
  await db.execute(`INSERT INTO evaluation_contexts(context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,ontology_fingerprint,policy_version,profile_version) VALUES(?,'tenant_A','person_A','sps_A','v1','hash_ontology','staged-v8','profile')`,[identity.evaluationContextFingerprint]);
  await db.execute(`INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url) VALUES('job','LinkedIn','source-job','https://example.com/job')`);
  const hash=computeContentHash({title:'Head of Growth',companyName:'Company',location:null,employmentType:null,rawContent:'Lead growth.'});
  await db.execute(`INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,company_name,raw_content) VALUES('version','job',?,'Head of Growth','Company','Lead growth.')`,[hash]);
  for(const [id,text]of [['one','Employment began in April 2023.'],['two','Employment began in May 2023.']]){
   const textHash=createHash('sha256').update(text).digest('hex');
   await db.execute(`INSERT INTO candidate_documents(id,tenant_id,person_id,filename,storage_uri,mime_type,document_hash) VALUES(?,'tenant_A','person_A',?,'fixture','text/plain',?)`,[id,id,textHash]);
   await db.execute(`INSERT INTO document_contents(id,tenant_id,person_id,document_id,raw_text,text_hash) VALUES(?,'tenant_A','person_A',?,?,?)`,[`text-${id}`,id,text,textHash]);
   await db.execute(`INSERT INTO evidence_graphs(id,tenant_id,person_id,document_id,graph_json,extractor_version,prompt_version,model) VALUES(?,'tenant_A','person_A',?,'{}','fixture','fixture','fixture')`,[`graph-${id}`,id]);
   await db.execute(`INSERT INTO profile_projection_source_bindings(tenant_id,person_id,profile_version,document_id,evidence_graph_id,document_text_hash) VALUES('tenant_A','person_A','profile',?,?,?)`,[id,`graph-${id}`,textHash]);
  }
  vi.spyOn(pipeline,'extractValidatedSourceClaims').mockImplementation(async(_model,document,prefix)=>[{id:`${prefix}1`,text:document.text,plane:document.plane,state:'EXPLICIT',confidence:1,citations:[{sourceId:document.id,quote:document.text}],derivedFrom:[]}]);
 });
 it('freezes acquired context and candidate conflicts and never reacquires them on replay',async()=>{
  const acquisition=provider(),reasoning=model();
  const adapter=new ProductionStagedInputAdapter(db,undefined,[acquisition]);
  const first=await adapter.build(identity,reasoning);
  expect(first.evidence.some(claim=>claim.plane==='CONTEXT')).toBe(true);
  expect(first.candidateDecisionProfile?.projection?.currentTitle).toBe('SVP Growth');
  expect(first.candidateDecisionProfile?.intent?.decisionPreferences).toEqual({careerMove:'PROGRESSION'});
  expect(first.acquisition).toHaveLength(contextFields.length);
  expect(first.candidateConflicts[0].sourceIds).toHaveLength(2);
  const replay=await adapter.build(identity,reasoning);
  expect(replay).toEqual(first);expect(acquisition.acquire).toHaveBeenCalledTimes(1);expect(reasoning.generate).toHaveBeenCalledTimes(2);
  const other={...identity,evaluationContextFingerprint:contextFingerprint('sps_new')};
  await db.execute(`INSERT INTO search_plan_snapshots(id,tenant_id,person_id,search_plan_id,snapshot_hash,payload_json) VALUES('sps_new','tenant_A','person_A','plan_A','new-search-snapshot','{}')`);
  await db.execute(`INSERT INTO evaluation_contexts(context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,ontology_fingerprint,policy_version,profile_version) VALUES(?,'tenant_A','person_A','sps_new','v1','hash_ontology','staged-v8','profile')`,[other.evaluationContextFingerprint]);
  const changed:ContextProvider={id:'changed',async acquire(){return {sources:[{...source,text:'Company closed operations.'}],attempts:[{provider:'changed',field:'companySize',operation:'retrieve',status:'RETRIEVED',sourceIds:[source.id],detail:'Retrieved evidence.'}]};}};
  const refreshed=await new ProductionStagedInputAdapter(db,undefined,[changed]).build(other,reasoning);
  expect(refreshed.fingerprint).not.toBe(first.fingerprint);expect(await adapter.build(identity,reasoning)).toEqual(first);
 });
 it('keeps frozen inputs distinct across model configuration changes',async()=>{
  const acquisition=provider();
  const firstModel={...model(),configurationFingerprint:'config-a'};
  const secondModel={...model(),configurationFingerprint:'config-b'};
  const adapter=new ProductionStagedInputAdapter(db,undefined,[acquisition]);
  const first=await adapter.build(identity,firstModel);
  const second=await adapter.build(identity,secondModel);
  expect(first.fingerprint).toBe(second.fingerprint);
  expect(await db.one('SELECT COUNT(*) n FROM staged_frozen_inputs')).toEqual({n:2});
  expect(acquisition.acquire).toHaveBeenCalledTimes(2);
  expect(await adapter.build(identity,firstModel)).toEqual(first);
  expect(acquisition.acquire).toHaveBeenCalledTimes(2);
 });
 it('rejects a corrupted input snapshot before model or network work',async()=>{
  const acquisition=provider(),reasoning=model();const adapter=new ProductionStagedInputAdapter(db,undefined,[acquisition]);
  await adapter.build(identity,reasoning);
  await db.execute(`UPDATE staged_frozen_inputs SET input_json=json_set(input_json,'$.sources[0].text','Altered source')`);
  await expect(adapter.build(identity,reasoning)).rejects.toThrow('STAGED_INPUT_SNAPSHOT_HASH_MISMATCH');
  expect(acquisition.acquire).toHaveBeenCalledTimes(1);
 });
 it('rejects missing search configuration before any network call',async()=>{
  const request=vi.fn();
  await expect(new ProductionContextProvider(db,'tenant_A',request,'').acquire({id:'job',company:'Company',title:'Head'},contextFields)).rejects.toThrow('CONTEXT_SEARCH_CONFIGURATION_REQUIRED');
  expect(request).not.toHaveBeenCalled();
 });
 it.each([401,429,503])('keeps HTTP %s failures retryable instead of freezing them',async status=>{
  const request=vi.fn(async()=>new Response('provider error',{status}));
  await expect(new ProductionContextProvider(db,'tenant_A',request,'test').acquire({id:'job',company:'Company',title:'Head'},contextFields)).rejects.toThrow(`CONTEXT_SEARCH_HTTP_${status}`);
 });
 it('distinguishes an operational search with no evidence from an outage',async()=>{
  const result=await new ProductionContextProvider(db,'tenant_A',async()=>new Response(JSON.stringify({results:[]})),'test').acquire({id:'job',company:'Company',title:'Head'},contextFields);
  expect(result.sources).toEqual([]);
  expect(result.attempts.filter(a=>a.operation==='search').every(a=>a.status==='NO_RESULTS')).toBe(true);
 });
 it('rejects fresh input under a fingerprint that omits the acquisition policy',async()=>{
  await db.execute("UPDATE evaluation_contexts SET context_fingerprint='unbound-policy' WHERE context_fingerprint=?",[identity.evaluationContextFingerprint]);
  const acquisition=provider();
  await expect(new ProductionStagedInputAdapter(db,undefined,[acquisition]).build({...identity,evaluationContextFingerprint:'unbound-policy'},model())).rejects.toThrow('CONTEXT_ACQUISITION_POLICY_IDENTITY_MISMATCH');
  expect(acquisition.acquire).not.toHaveBeenCalled();
 });
 it('does not freeze an operational outage as successful immutable input',async()=>{
  const unavailable:ContextProvider={id:'unavailable',async acquire(){return {sources:[],attempts:contextFields.map(field=>({provider:'unavailable',field,operation:'search' as const,status:'UNAVAILABLE' as const,sourceIds:[],detail:'Search unavailable.'}))};}};
  await expect(new ProductionStagedInputAdapter(db,undefined,[unavailable]).build(identity,model())).rejects.toThrow('CONTEXT_ACQUISITION_NOT_OPERATIONAL');
  expect(await db.one('SELECT COUNT(*) n FROM staged_frozen_inputs')).toEqual({n:0});
 });
 it('rejects conflict references outside the exact candidate-source catalog',async()=>{
  const reasoning={id:'invalid-conflicts',version:'1',async generate(){return {candidateConflicts:[{topic:'Dates',sourceIds:['cv','context'],question:'Which date?'}]};}};
  await expect(pipeline.compareCandidateSources([{...source,id:'cv',plane:'CANDIDATE'},{...source,id:'cv2',plane:'CANDIDATE'}],[],reasoning)).rejects.toThrow('CANDIDATE_CONFLICT_SOURCE_PROVENANCE_INVALID');
 });
 it('uses the tenant-owned verified website and searches without sending candidate evidence',async()=>{
  await db.execute(`INSERT INTO intelligence_company_entities(tenant_id,id,normalized_name,official_domain) VALUES('tenant_A','company','company','company.example')`);
  const request=vi.fn(async(url:RequestInfo|URL,_init?:RequestInit)=>String(url).startsWith('https://api.tavily.com/')?new Response(JSON.stringify({results:[{url:'https://news.example/company',title:'Company expands',raw_content:'Company opened a regional office.'}]}),{status:200}):new Response('<html><body><main>Company operates in two markets.</main></body></html>',{status:200}));
  const result=await new ProductionContextProvider(db,'tenant_A',request as typeof fetch,'fixture-key').acquire({
    id:'job',
    company:'Company',
    title:'Head of Growth',
    researchIdentityTerms:['AI-first performance marketing agency helping eCommerce brands scale'],
    researchLocation:'Remote',
  } as any,contextFields);
  expect(result.sources).toHaveLength(2);expect(result.attempts.some(a=>a.operation==='search'&&a.status==='RETRIEVED')).toBe(true);
  const search=request.mock.calls.find(([url])=>String(url).includes('api.tavily.com'))!;
  expect(JSON.stringify(search)).not.toContain('Employment began');
  const query=JSON.parse(String(search[1]?.body)).query as string;
  expect(query).toContain('"Company"');
  expect(query).toContain('"performance marketing"');
  expect(query).toContain('company team');
  expect(query).not.toContain('Head of Growth');
  expect(query).not.toContain('Remote');
  expect(query).not.toContain('AI-first');
 });
});
