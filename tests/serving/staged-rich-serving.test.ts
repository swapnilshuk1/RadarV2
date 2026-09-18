import Database from 'better-sqlite3';
import { beforeEach,describe,expect,it,vi } from 'vitest';
import {act,createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import {DossierView} from '../../src/dossier/DossierView';
import {composeStagedDossier} from '../../src/dossier/staged-composition';
import type {StagedResearchInput} from '../../src/dossier/staged-research';
import { SqliteAdapter } from '../../src/data/database/sqlite';
import { setupLineageTestFixture,activateLineageTestContext } from '../persistence/lineage_fixture';
import { SqliteOpportunityQueries } from '../../src/data/sqlite/repositories/SqliteOpportunityQueries';
import { SqliteStagedEvaluationStore } from '../../src/data/sqlite/repositories/SqliteStagedEvaluationStore';
import { SqliteRichDossierStore } from '../../src/data/sqlite/repositories/SqliteRichDossierStore';
import { StagedServingPublisher } from '../../src/lib/intelligence/staged/StagedServingPublisher';
import { resolveServingScope } from '../../src/lib/security/scope-resolver';
import { resolveCanonicalServingReadModel } from '../../src/lib/intelligence/serving/CanonicalServingReadModel';
import type { Dossier,JsonValue,Passage } from '../../src/dossier/contracts';
import {
  createStagedEvaluationFingerprint,
  parseCanonicalStagedDecisionResult,
} from '../../src/dossier/staged-decision-integrity';
import { readAcquisitionFeed } from '../../src/lib/intelligence/acquisition-feed';
import { stagedRolloutReadiness,activateReadyStagedRollout } from '../../src/lib/intelligence/staged/StagedRolloutReadiness';

import {stagedEvaluation,evaluationFingerprint,dossier} from '../fixtures/staged-rich-dossier';
import {selectStagedDossierWork} from '../../src/lib/intelligence/staged/dossierBackfillSelection';
import {RICH_DOSSIER_VERSION} from '../../src/data/sqlite/repositories/SqliteRichDossierStore';

describe('rich staged serving activation',()=>{
  let db:SqliteAdapter;
  const identity={tenantId:'tenant_A',personId:'person_A',canonicalJobId:'job',opportunityVersion:'version',evaluationContextFingerprint:'staged-context',profileVersion:'profile'};
  beforeEach(async()=>{
    db=new SqliteAdapter(new Database(':memory:'));await setupLineageTestFixture(db);
    await db.execute(`INSERT INTO users(id,email) VALUES('person_A','a@a.com')`);
    await db.execute(`INSERT INTO memberships(user_id,tenant_id,role,permissions,status) VALUES('person_A','tenant_A','admin','["*"]','active')`);
    await activateLineageTestContext(db);
    await db.execute(`INSERT INTO evaluation_contexts(context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,ontology_fingerprint,policy_version,profile_version) VALUES('staged-context','tenant_A','person_A','sps_A','v1','hash_ontology','staged-v6','profile')`);
    await db.execute(`INSERT INTO evaluation_context_scopes(context_fingerprint,tenant_id,person_id,search_plan_id) VALUES('staged-context','tenant_A','person_A','plan_A')`);
    await db.execute(`INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url) VALUES('job','LinkedIn','source-job','https://example.com/job')`);
    await db.execute(`INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,raw_content,lifecycle_state) VALUES('version','job','hash','Head of Growth','Lead growth.','ACTIVE')`);
    await db.execute(`INSERT INTO search_plan_candidates(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision) VALUES('tenant_A','person_A','plan_A','job','version','CANDIDATE')`);
    await new SqliteStagedEvaluationStore(db).save({...identity,jobHash:'job',policyVersion:'staged-v6',ontologyVersion:'v1',ontologyFingerprint:'hash_ontology',inputFingerprint:'input',sourceFingerprints:['jd'],modelId:'test',modelVersion:'test',contractVersion:'staged-decision-v6',evaluationState:'COMPLETED',decision:'PURSUE',screeningViability:'PLAUSIBLE',evaluation:stagedEvaluation,evaluatedAt:'2026-01-01'});
  });
  it('requires an exact-trace dossier and keeps projection separate from serving activation',async()=>{
    const publisher=new StagedServingPublisher(db);
    await expect(publisher.publish(identity)).rejects.toThrow('SERVING_REQUIRES_MATCHING_DOSSIER');
    await new SqliteRichDossierStore(db).save(identity,evaluationFingerprint,dossier());
    await publisher.publish(identity);
    const queries=new SqliteOpportunityQueries(db);const {scope}=await resolveServingScope('person_A','tenant_A',db);
    expect((await queries.getFeed(scope)).items[0].evaluationState).toBe('UNMATERIALIZED');
    await db.execute(`UPDATE active_evaluation_contexts SET context_fingerprint='staged-context' WHERE person_id='person_A'`);
    const feed=await queries.getFeed(scope,undefined,{shortlistQueue:true});
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({engineVerdict:'PURSUE',qualityScore:null,evaluationState:'EVALUATED'});
    const detail=await queries.getDossier(scope,'source-job');
    expect(detail).toMatchObject({evaluationState:'EVALUATED',richDossier:{verdict:{verdict:'PURSUE'},canonicalDecisionTrace:{requirements:[{id:'REQ-001',screeningSupportQuoteIds:['REQ-001:Q1']}]}}});
    const metrics=await queries.getMetrics(scope);
    expect(metrics.engineBreakdown.pursue).toBe(1);
    expect(metrics.evaluationPopulation.evaluated).toBe(1);
    expect((await queries.getNavigation(scope,'source-job',{shortlistQueue:true}))?.totalCount).toBe(1);
    expect(await db.one('SELECT COUNT(*) AS n FROM canonical_decisions')).toEqual({n:0});
  });
  it('rejects unreviewed, incompletely reviewed and post-review edited dossiers at storage',async()=>{
    const store=new SqliteRichDossierStore(db);
    const absent=dossier();delete absent.generation.factualReviewer;delete absent.generation.factualReviews;
    await expect(store.save(identity,evaluationFingerprint,absent)).rejects.toThrow('DOSSIER_FACTUAL_REVIEW_REQUIRED');
    const incomplete=dossier();incomplete.generation.factualReviews!.pop();
    await expect(store.save(identity,evaluationFingerprint,incomplete)).rejects.toThrow('DOSSIER_FACTUAL_REVIEW_INCOMPLETE');
    const edited=dossier();edited.executiveThesis.text='This precise factual assertion was never reviewed.';
    await expect(store.save(identity,evaluationFingerprint,edited)).rejects.toThrow('DOSSIER_FACTUAL_REVIEW_BINDING_MISMATCH');
    const changedEvidence=dossier();changedEvidence.evidence.roleClaims[0].text='Different evidence';
    await expect(store.save(identity,evaluationFingerprint,changedEvidence)).rejects.toThrow('DOSSIER_FACTUAL_REVIEW_BINDING_MISMATCH');
    expect(await db.one('SELECT COUNT(*) n FROM materialized_dossier_presentations')).toEqual({n:0});
  });
  it('rejects corrupt presentation JSON from serving, publish-only selection and readiness',async()=>{
    const store=new SqliteRichDossierStore(db);await store.save(identity,evaluationFingerprint,dossier());
    await new StagedServingPublisher(db).publish(identity);
    await db.execute("UPDATE materialized_dossier_presentations SET presentation_json=json_remove(presentation_json,'$.generation.factualReviews')");
    expect(await store.get(identity,evaluationFingerprint)).toBeNull();
    await expect(new StagedServingPublisher(db).publish(identity)).rejects.toThrow('SERVING_REQUIRES_MATCHING_DOSSIER');
    expect(await selectStagedDossierWork(db,{context:'staged-context',limit:10,publishOnly:true})).toEqual([]);
    expect(await selectStagedDossierWork(db,{context:'staged-context',limit:10})).toHaveLength(1);
    expect((await stagedRolloutReadiness(db,{tenantId:'tenant_A',personId:'person_A',searchPlanId:'plan_A',contextFingerprint:'staged-context'})).ready).toBe(false);
  });
  it('preserves an already published historical dossier when the current write version advances',async()=>{
    const store=new SqliteRichDossierStore(db);await store.save(identity,evaluationFingerprint,dossier());
    await new StagedServingPublisher(db).publish(identity);
    await db.execute("UPDATE materialized_dossier_presentations SET presentation_version='dossier-v3.5'");
    await db.execute("UPDATE materialized_evaluations SET evaluation_json=json_remove(evaluation_json,'$.presentationVersion')");
    await db.execute("UPDATE active_evaluation_contexts SET context_fingerprint='staged-context' WHERE person_id='person_A'");
    const {scope}=await resolveServingScope('person_A','tenant_A',db);
    expect(await store.get(identity,evaluationFingerprint)).toBeNull();
    expect((await new SqliteOpportunityQueries(db).getDossier(scope,'source-job'))?.evaluationState).toBe('EVALUATED');
    // Historical presentation cannot silently qualify as current rollout coverage.
    expect(await selectStagedDossierWork(db,{context:'staged-context',limit:10})).toHaveLength(1);
  });
  it('will not approve a context-aware rollout merely because rows exist without Tavily',async()=>{
    await new SqliteRichDossierStore(db).save(identity,evaluationFingerprint,dossier());
    await new StagedServingPublisher(db).publish(identity);
    await db.execute("UPDATE evaluation_contexts SET policy_version='staged-v8' WHERE context_fingerprint='staged-context'");
    const previous=process.env.TAVILY_API_KEY;delete process.env.TAVILY_API_KEY;
    try{
      const result=await stagedRolloutReadiness(db,{tenantId:'tenant_A',personId:'person_A',searchPlanId:'plan_A',contextFingerprint:'staged-context'});
      expect(result.ready).toBe(false);expect(result.blockers).toContain('CONTEXT_SEARCH_CONFIGURATION_REQUIRED');expect(result.prepared).toBe(0);
    }finally{if(previous===undefined)delete process.env.TAVILY_API_KEY;else process.env.TAVILY_API_KEY=previous;}
  });
  it('rejects a dossier that keeps the headline but rewrites canonical decision detail',async()=>{
    const wrongTrace=structuredClone(stagedEvaluation.trace) as unknown as JsonValue;
    (wrongTrace as {requirements:Array<{screeningReasoning:string}>}).requirements[0].screeningReasoning='Rewritten by presentation';
    await new SqliteRichDossierStore(db).save(identity,evaluationFingerprint,dossier(wrongTrace));
    await expect(new StagedServingPublisher(db).publish(identity)).rejects.toThrow('DOSSIER_DECISION_TRACE_MISMATCH');
  });
  it('composes, persists and serves canonical intelligence into both interactive DossierView templates',async()=>{
    const template=dossier();
    const frozen:StagedResearchInput={opportunity:template.opportunity,candidate:template.candidate,sources:template.evidence.lineage,evidence:template.evidence.roleClaims,candidateSourceRefs:[],candidateConflicts:[],acquisition:[],validEvidenceClaimIds:['JD-1-1'],fields:[],fingerprint:'input'};
    const model={id:'local-scripted-composer',version:'1',async generate(instruction:string,input:unknown){
      if(input && typeof input==='object' && 'factualReview' in input)throw new Error('Factual review must use the independent reviewer');
      if(input && typeof input==='object' && 'fixedAction' in input)return {aligned:true,issue:''};
      const section=instruction.match(/For this call return ONLY the top-level key (\w+)/)?.[1];
      if(section)return {[section]:template[section as keyof Dossier]};
      return {rationale:template.verdict.rationale,narrativePlan:template.narrativePlan};
    }};
    const reviewer={id:'independent-reviewer',version:'1',async generate(_instruction:string,input:any){return {reviews:input.factualReview.passages.map((p:any)=>({passageId:p.passageId,externalComparison:'NONE',candidateAbsence:'NONE',factualAssessment:'Fixture evidence supports the passage.',supported:true,issue:''}))};}};
    const composed=await composeStagedDossier(frozen,stagedEvaluation,model,reviewer);
    expect(composed.generation.factualReviewer).toEqual({model:'independent-reviewer/1',policyVersion:'editorial-facts-v2'});
    await new SqliteRichDossierStore(db).save(identity,evaluationFingerprint,{...composed,sourceInputFingerprint:'input',sourceEvaluationFingerprint:evaluationFingerprint});
    await new StagedServingPublisher(db).publish(identity);
    await db.execute(`UPDATE active_evaluation_contexts SET context_fingerprint='staged-context' WHERE person_id='person_A'`);
    const {scope}=await resolveServingScope('person_A','tenant_A',db);
    const dto=await new SqliteOpportunityQueries(db).getDossier(scope,'source-job');
    expect(dto?.evaluationState).toBe('EVALUATED');
    const rich=(dto as {richDossier:Dossier}).richDossier;
    expect(rich.generation.factualReviewer).toEqual(composed.generation.factualReviewer);
    expect(rich.canonicalDecisionTrace).toEqual(stagedEvaluation.trace);
    const dom=new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>');
    vi.stubGlobal('window',dom.window);vi.stubGlobal('document',dom.window.document);vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
    const container=dom.window.document.getElementById('root')!;const root=createRoot(container);
    try{
      await act(async()=>root.render(createElement(DossierView,{dossier:rich})));
      expect(container.querySelector('.dossier-template-a')).not.toBeNull();
      expect(container.textContent).toContain('PURSUE');
      expect(container.textContent).toContain('Assess the growth mandate.');
      const switcher=Array.from(container.querySelectorAll('button')).find(button=>button.textContent?.startsWith('Template B'))!;
      await act(async()=>switcher.click());
      expect(container.querySelector('.dossier-template-b')).not.toBeNull();
      expect(container.textContent).toContain('Executive advisory thesis');
      const cue=container.querySelector<HTMLButtonElement>('button[aria-label^="Show evidence:"]')!;
      await act(async()=>cue.click());
      expect(container.textContent).toContain('Lead growth.');
      expect(await db.one('SELECT COUNT(*) n FROM canonical_decisions')).toEqual({n:0});
    }finally{await act(async()=>root.unmount());dom.window.close();vi.unstubAllGlobals();}
  });
  it('never uses the input fingerprint as an alias for an exact evaluation fingerprint',async()=>{
    const store=new SqliteRichDossierStore(db);
    await store.save(identity,evaluationFingerprint,dossier());
    expect(await store.get(identity,'input')).toBeNull();
    expect(await store.get(identity,evaluationFingerprint)).not.toBeNull();
    await new StagedServingPublisher(db).publish(identity);
    await db.execute(`UPDATE active_evaluation_contexts SET context_fingerprint='staged-context' WHERE person_id='person_A'`);
    const {scope}=await resolveServingScope('person_A','tenant_A',db);
    expect((await new SqliteOpportunityQueries(db).getDossier(scope,'source-job'))?.evaluationState).toBe('EVALUATED');
    // Simulate a stale presentation tied to a different result with the same input.
    await db.execute(`UPDATE materialized_dossier_presentations SET source_evaluation_fingerprint='different-evaluation',presentation_json=json_set(presentation_json,'$.sourceEvaluationFingerprint','different-evaluation')`);
    expect(await store.get(identity,evaluationFingerprint)).toBeNull();
    expect((await new SqliteOpportunityQueries(db).getDossier(scope,'source-job'))?.evaluationState).toBe('INVALID');
  });
  it('selects an existing v3.4 dossier for publish-only using the full evaluation fingerprint',async()=>{
    const options={context:'staged-context',limit:10,publishOnly:true};
    expect(await selectStagedDossierWork(db,options)).toEqual([]);
    await new SqliteRichDossierStore(db).save(identity,evaluationFingerprint,dossier());
    expect(await selectStagedDossierWork(db,{...options,publishOnly:false})).toEqual([]);
    expect(await selectStagedDossierWork(db,options)).toHaveLength(1);
    await new StagedServingPublisher(db).publish(identity);
    expect(await selectStagedDossierWork(db,options)).toEqual([]);
  });
  it('keeps a missing legacy score invalid while accepting an explicitly staged scoreless contract',()=>{
    const input={engineVerdict:'PURSUE',userDecision:null,evaluationContextFingerprint:'ctx',evaluationFingerprint:'eval',reviewedFingerprint:null,qualityScore:null};
    expect(resolveCanonicalServingReadModel({...input,evaluationState:'EVALUATED'}).evaluationState).toBe('INVALID');
    expect(resolveCanonicalServingReadModel({...input,evaluationState:'STAGED_EVALUATED'}).evaluationState).toBe('EVALUATED');
  });
  it('keeps pending and failed dossier work visible only in its owning search scope',async()=>{
    const active={contextFingerprint:'staged-context',searchPlanId:'plan_A'};
    await db.execute(`INSERT INTO evaluation_requirements(id,tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,required_enrichment_pipeline_version,evaluation_context_fingerprint,status) VALUES('req','tenant_A','person_A','plan_A','job','version','1.0.0','staged-context','SATISFIED')`);
    await db.execute(`INSERT INTO evaluation_jobs(id,tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,evaluation_context_fingerprint,status) VALUES('ej','tenant_A','person_A','plan_A','job','version','staged-context','staged_completed')`);
    expect((await readAcquisitionFeed(db,identity,active)).rows[0].state).toBe('PREPARING');
    const store=new SqliteRichDossierStore(db);
    await store.recordFailure(identity,evaluationFingerprint,new Error('Presentation unavailable'));
    expect((await readAcquisitionFeed(db,identity,active)).rows[0].state).toBe('NEEDS_ATTENTION');
    expect((await readAcquisitionFeed(db,{tenantId:'tenant_B',personId:'person_B'},active)).total).toBe(0);
    await store.save(identity,evaluationFingerprint,dossier());
    await new StagedServingPublisher(db).publish(identity);
    expect((await readAcquisitionFeed(db,identity,active)).rows[0].state).toBe('READY');
  });
  it('activates only complete serving coverage and never overwrites an independently changed context',async()=>{
    await db.execute(`UPDATE opportunity_versions SET acquisition_status='ACQUIRED'`);
    const scope={...identity,contextFingerprint:'staged-context',searchPlanId:'plan_A'};
    const old=(await db.one<{context_fingerprint:string}>(`SELECT context_fingerprint FROM active_evaluation_contexts WHERE person_id='person_A'`))!.context_fingerprint;
    expect(await stagedRolloutReadiness(db,scope)).toMatchObject({total:1,unprepared:1,ready:false});
    await expect(activateReadyStagedRollout(db,scope,old)).rejects.toThrow('ROLLOUT_COVERAGE_INCOMPLETE');
    await new SqliteRichDossierStore(db).save(identity,evaluationFingerprint,dossier());await new StagedServingPublisher(db).publish(identity);
    expect(await stagedRolloutReadiness(db,scope)).toMatchObject({prepared:1,unprepared:0,ready:true});
    await expect(activateReadyStagedRollout(db,scope,'unrelated')).rejects.toThrow('ROLLOUT_ACTIVE_CONTEXT_CHANGED');
    await activateReadyStagedRollout(db,scope,old);
    expect((await db.one<{context_fingerprint:string}>(`SELECT context_fingerprint FROM active_evaluation_contexts WHERE person_id='person_A'`))!.context_fingerprint).toBe('staged-context');
  });
});
