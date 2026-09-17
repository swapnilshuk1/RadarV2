import Database from 'better-sqlite3';
import { beforeEach,describe,expect,it } from 'vitest';
import { SqliteAdapter } from '../../src/data/database/sqlite';
import { setupLineageTestFixture,activateLineageTestContext } from '../persistence/lineage_fixture';
import { SqliteOpportunityQueries } from '../../src/data/sqlite/repositories/SqliteOpportunityQueries';
import { SqliteStagedEvaluationStore } from '../../src/data/sqlite/repositories/SqliteStagedEvaluationStore';
import { SqliteRichDossierStore } from '../../src/data/sqlite/repositories/SqliteRichDossierStore';
import { StagedServingPublisher } from '../../src/lib/intelligence/staged/StagedServingPublisher';
import { resolveServingScope } from '../../src/lib/security/scope-resolver';
import { resolveCanonicalServingReadModel } from '../../src/lib/intelligence/serving/CanonicalServingReadModel';
import type { Dossier,Passage } from '../../src/dossier/contracts';
import { readAcquisitionFeed } from '../../src/lib/intelligence/acquisition-feed';
import { stagedRolloutReadiness,activateReadyStagedRollout } from '../../src/lib/intelligence/staged/StagedRolloutReadiness';

function dossier():Dossier {
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
    resolutions:[],candidateConflicts:[],evidence:{roleClaims:[{id:'JD-1-1',text:'Lead growth.',state:'EXPLICIT',confidence:1,plane:'JD',citations:[{sourceId:'jd',quote:'Lead growth.'}],derivedFrom:[]}],candidateClaims:[],contextualClaims:[],relationalClaims:[],lineage:[{id:'jd',plane:'JD',title:'JD',locator:'job',text:'Lead growth.',capturedAt:'2026-01-01T00:00:00.000Z',attribution:'JOB_POST'}]},
    generatedAt:'2026-01-01',generation:{model:'test',sourceFingerprint:'sources'},acquisition:[],
  };
}
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
    await new SqliteStagedEvaluationStore(db).save({...identity,jobHash:'job',policyVersion:'staged-v6',ontologyVersion:'v1',ontologyFingerprint:'hash_ontology',inputFingerprint:'input',sourceFingerprints:['jd'],modelId:'test',modelVersion:'test',contractVersion:'staged-decision-v6',evaluationState:'COMPLETED',decision:'PURSUE',screeningViability:'PLAUSIBLE',evaluation:{decision:{verdict:'PURSUE'}},evaluatedAt:'2026-01-01'});
  });
  it('requires a dossier and keeps projection separate from serving activation',async()=>{
    const publisher=new StagedServingPublisher(db);
    await expect(publisher.publish(identity)).rejects.toThrow('SERVING_REQUIRES_MATCHING_DOSSIER');
    await new SqliteRichDossierStore(db).save(identity,'input',dossier());
    await publisher.publish(identity);
    const queries=new SqliteOpportunityQueries(db);const {scope}=await resolveServingScope('person_A','tenant_A',db);
    expect((await queries.getFeed(scope)).items[0].evaluationState).toBe('UNMATERIALIZED');
    await db.execute(`UPDATE active_evaluation_contexts SET context_fingerprint='staged-context' WHERE person_id='person_A'`);
    const feed=await queries.getFeed(scope,undefined,{shortlistQueue:true});
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0]).toMatchObject({engineVerdict:'PURSUE',qualityScore:null,evaluationState:'EVALUATED'});
    const detail=await queries.getDossier(scope,'source-job');
    expect(detail).toMatchObject({evaluationState:'EVALUATED',richDossier:{verdict:{verdict:'PURSUE'}}});
    const metrics=await queries.getMetrics(scope);
    expect(metrics.engineBreakdown.pursue).toBe(1);
    expect(metrics.evaluationPopulation.evaluated).toBe(1);
    expect((await queries.getNavigation(scope,'source-job',{shortlistQueue:true}))?.totalCount).toBe(1);
    expect(await db.one('SELECT COUNT(*) AS n FROM canonical_decisions')).toEqual({n:0});
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
    await store.recordFailure(identity,'input',new Error('Presentation unavailable'));
    expect((await readAcquisitionFeed(db,identity,active)).rows[0].state).toBe('NEEDS_ATTENTION');
    expect((await readAcquisitionFeed(db,{tenantId:'tenant_B',personId:'person_B'},active)).total).toBe(0);
    await store.save(identity,'input',dossier());
    await new StagedServingPublisher(db).publish(identity);
    expect((await readAcquisitionFeed(db,identity,active)).rows[0].state).toBe('READY');
  });
  it('activates only complete serving coverage and never overwrites an independently changed context',async()=>{
    await db.execute(`UPDATE opportunity_versions SET acquisition_status='ACQUIRED'`);
    const scope={...identity,contextFingerprint:'staged-context',searchPlanId:'plan_A'};
    const old=(await db.one<{context_fingerprint:string}>(`SELECT context_fingerprint FROM active_evaluation_contexts WHERE person_id='person_A'`))!.context_fingerprint;
    expect(await stagedRolloutReadiness(db,scope)).toMatchObject({total:1,unprepared:1,ready:false});
    await expect(activateReadyStagedRollout(db,scope,old)).rejects.toThrow('ROLLOUT_COVERAGE_INCOMPLETE');
    await new SqliteRichDossierStore(db).save(identity,'input',dossier());await new StagedServingPublisher(db).publish(identity);
    expect(await stagedRolloutReadiness(db,scope)).toMatchObject({prepared:1,unprepared:0,ready:true});
    await expect(activateReadyStagedRollout(db,scope,'unrelated')).rejects.toThrow('ROLLOUT_ACTIVE_CONTEXT_CHANGED');
    await activateReadyStagedRollout(db,scope,old);
    expect((await db.one<{context_fingerprint:string}>(`SELECT context_fingerprint FROM active_evaluation_contexts WHERE person_id='person_A'`))!.context_fingerprint).toBe('staged-context');
  });
});
