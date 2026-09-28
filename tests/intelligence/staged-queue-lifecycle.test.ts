import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelProviderUnavailableError } from '../../src/lib/model/provider-unavailable';
import { ProductionStagedEvaluationService } from '../../src/lib/intelligence/staged/ProductionStagedEvaluationService';
import { StagedServingPublisher } from '../../src/lib/intelligence/staged/StagedServingPublisher';
import { SqliteDossierCompositionQueue } from '../../src/data/sqlite/repositories/SqliteDossierCompositionQueue';
import { stagedEvaluation } from '../fixtures/staged-rich-dossier';
import { SqliteAdapter } from '../../src/data/database/sqlite';
import { setupLineageTestFixture } from '../persistence/lineage_fixture';
import { EvaluationWorkScheduler } from '../../src/lib/intelligence/EvaluationWorkScheduler';
import { EvaluationWorker } from '../../src/lib/intelligence/EvaluationWorker';
import { EvaluationRuntimeControl } from '../../src/lib/intelligence/EvaluationRuntimeControl';
import { EnrichmentQueue } from '../../scripts/scraper/persist/queue';
import { RunReconciliationService } from '../../src/lib/intelligence/RunReconciliationService';
import { computeContentHash } from '../../src/lib/domain/canonical_identity';

describe('staged enrichment dependency lifecycle', () => {
  let db: SqliteAdapter;
  const identity = {tenantId:'tenant_A',personId:'person_A',searchPlanId:'plan_A',canonicalJobId:'job',opportunityVersion:'version',evaluationContextFingerprint:'staged-context'};
  beforeEach(async () => {
    db = new SqliteAdapter(new Database(':memory:'));
    await setupLineageTestFixture(db);
    await db.execute(`INSERT INTO evaluation_contexts (context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,ontology_fingerprint,policy_version,profile_version) VALUES ('staged-context','tenant_A','person_A','sps_A','v1','hash_ontology','staged-v8','profile')`);
    await db.execute(`INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url) VALUES ('job','LinkedIn','source-job','https://example.com/job')`);
    await db.execute(`INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,raw_content) VALUES ('version','job',?,'Head of Growth','Job description')`,[computeContentHash({title:'Head of Growth',companyName:null,location:null,employmentType:null,rawContent:'Job description'})]);
    await db.execute(`INSERT INTO search_plan_candidates(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision) VALUES ('tenant_A','person_A','plan_A','job','version','CANDIDATE')`);
    await db.execute(`INSERT OR IGNORE INTO evaluation_context_scopes(context_fingerprint,tenant_id,person_id,search_plan_id) VALUES('staged-context','tenant_A','person_A','plan_A')`);
    await db.execute(`INSERT INTO active_evaluation_contexts(tenant_id,person_id,search_plan_id,context_fingerprint,activated_by) VALUES('tenant_A','person_A','plan_A','staged-context','test-fixture')`);
    await db.execute(`INSERT INTO evaluation_runtime_control(tenant_id,person_id,desired_state,updated_at,updated_by) VALUES('tenant_A','person_A','RUNNING',0,'test-fixture')`);
  });
  async function enrichment(version='version',pipeline='1.0.0',status='COMPLETE') {
    await db.execute(`INSERT INTO enrichment_jobs(id,job_hash,canonical_job_id,opportunity_version,pipeline_version,status) VALUES (?,?,?,?,?,?)`,[`enrich-${version}-${pipeline}`,'job','job',version,pipeline,status]);
  }
  async function state() {
    return db.one<{status:string;requirement:string;blocked_reason:string|null}>(`SELECT ej.status,er.status AS requirement,er.blocked_reason FROM evaluation_jobs ej JOIN evaluation_requirements er ON er.evaluation_context_fingerprint=ej.evaluation_context_fingerprint`);
  }
  it('requires an explicit Start before the worker may claim queued evaluation work', async () => {
    await db.execute(`UPDATE opportunity_versions SET acquisition_status='ACQUIRED',lifecycle_state='ACTIVE'`);
    await enrichment();
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    await db.execute(`DELETE FROM evaluation_runtime_control WHERE tenant_id='tenant_A' AND person_id='person_A'`);

    const worker = new EvaluationWorker(db);
    await expect(worker.claimNextJob()).resolves.toBeNull();

    await new EvaluationRuntimeControl(db).set(
      { tenantId: 'tenant_A', personId: 'person_A' },
      'RUNNING',
      'test-user',
    );
    await expect(worker.claimNextJob()).resolves.toMatchObject({
      tenantId: 'tenant_A',
      personId: 'person_A',
      canonicalJobId: 'job',
    });
  });

  it('default daemon claims only the active evaluation context, never stale queued work', async () => {
    await db.execute(`UPDATE opportunity_versions SET acquisition_status='ACQUIRED',lifecycle_state='ACTIVE'`);
    await enrichment();
    await db.execute(`INSERT INTO evaluation_contexts (context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,ontology_fingerprint,policy_version,profile_version) VALUES ('stale-context','tenant_A','person_A','sps_A','v1','hash_ontology','staged-v8','stale-profile')`);
    await new EvaluationWorkScheduler(db).ensureWork({...identity,evaluationContextFingerprint:'stale-context'});
    await db.execute(`UPDATE evaluation_jobs SET created_at='2026-01-01 00:00:00',next_attempt_at='2026-01-01 00:00:00' WHERE evaluation_context_fingerprint='stale-context'`);
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    const claimed=await new EvaluationWorker(db).claimNextJob();
    expect(claimed?.evaluationContextFingerprint).toBe('staged-context');
    expect(await db.one(`SELECT status FROM evaluation_jobs WHERE evaluation_context_fingerprint='stale-context'`)).toEqual({status:'staged_pending'});
  });
  it.each(['PURSUE','CONSIDER','PASS'] as const)('completes %s while composing only actionable active-context results',async decision=>{
    await db.execute(`UPDATE opportunity_versions SET acquisition_status='ACQUIRED',lifecycle_state='ACTIVE'`);
    await enrichment();await new EvaluationWorkScheduler(db).ensureWork(identity);
    const worker=new EvaluationWorker(db);const job=await worker.claimNextJob();
    const evaluation=structuredClone(stagedEvaluation);
    evaluation.decision.verdict=decision;
    evaluation.trace.decision.verdict=decision;
    const evaluate=vi.spyOn(ProductionStagedEvaluationService.prototype,'evaluate').mockResolvedValue({
      ...identity,
      profileVersion:'profile',
      policyVersion:'staged-v8',
      ontologyVersion:'v1',
      ontologyFingerprint:'hash_ontology',
      jobHash:'job',
      inputFingerprint:'input',
      sourceFingerprints:['jd'],
      modelId:'test',
      modelVersion:'test',
      modelConfigurationFingerprint:'test-config',
      contractVersion:'staged-decision-v8',
      evaluationState:'COMPLETED',
      decision,
      screeningViability:evaluation.decision.screeningViability,
      evaluation,
      evaluatedAt:'2026-09-22T00:00:00.000Z',
    } as any);
    const publish=vi.spyOn(StagedServingPublisher.prototype,'publish').mockResolvedValue(undefined as any);
    try{
      expect(await worker.processJob(job!)).toMatchObject({status:'completed',decision});
      expect(publish).toHaveBeenCalledTimes(decision==='PASS'?0:1);
      if(decision==='PASS'){
        expect(await db.one('SELECT COUNT(*) n FROM dossier_composition_jobs')).toEqual({n:0});
      }else{
        expect(await db.one('SELECT COUNT(*) n FROM dossier_composition_jobs')).toEqual({n:1});
        const queued=await db.one<{status:string}>('SELECT status FROM dossier_composition_jobs');
        expect(queued).toEqual({status:'pending'});
        expect(publish).toHaveBeenCalledWith(expect.objectContaining({
          canonicalJobId:'job',
          evaluationContextFingerprint:'staged-context',
        }),{allowPreparing:true});
      }
      expect(await state()).toMatchObject({status:'staged_completed',requirement:'SATISFIED'});
      const timing=await db.one<{
        firstClaimed:number;
        evaluationPersisted:number;
        dossierQueued:number;
        completed:number;
      }>(`SELECT
          first_claimed_at IS NOT NULL AS firstClaimed,
          evaluation_persisted_at IS NOT NULL AS evaluationPersisted,
          dossier_queued_at IS NOT NULL AS dossierQueued,
          completed_at IS NOT NULL AS completed
        FROM evaluation_jobs`);
      expect(timing).toEqual({
        firstClaimed:1,
        evaluationPersisted:1,
        dossierQueued:decision==='PASS'?0:1,
        completed:1,
      });
    }finally{evaluate.mockRestore();publish.mockRestore();}
  });
  it.each([[403,900_000],[429,45_000]])('releases the owned lease with provider-specific delay for HTTP %s without spending attempts',async(httpStatus,retryAfterMs)=>{
    await db.execute(`UPDATE opportunity_versions SET acquisition_status='ACQUIRED',lifecycle_state='ACTIVE'`);
    await enrichment();await new EvaluationWorkScheduler(db).ensureWork(identity);
    const worker=new EvaluationWorker(db);const job=await worker.claimNextJob();
    const error=new ModelProviderUnavailableError(`Provider HTTP ${httpStatus}`,httpStatus,retryAfterMs);
    const evaluation=vi.spyOn(ProductionStagedEvaluationService.prototype,'evaluate').mockRejectedValue(error);
    try{
      if(httpStatus===403) await expect(worker.processJob(job!)).resolves.toMatchObject({status:'retry_scheduled',error:'MODEL_CREDENTIAL: Provider HTTP 403'});
      else await expect(worker.processJob(job!)).rejects.toBe(error);
    }finally{evaluation.mockRestore();}
    expect(await state()).toMatchObject({status:'staged_pending',requirement:'READY'});
    expect(await db.one('SELECT attempts,locked_by,lease_token FROM evaluation_jobs')).toEqual({attempts:httpStatus===403?1:0,locked_by:null,lease_token:null});
    const delay=await db.one<{seconds:number}>(`SELECT CAST(strftime('%s',next_attempt_at)-strftime('%s','now') AS INTEGER) AS seconds FROM evaluation_jobs`);
    const expectedDelay=httpStatus===403?5:retryAfterMs/1000;
    expect(delay!.seconds).toBeGreaterThanOrEqual(expectedDelay-2);expect(delay!.seconds).toBeLessThanOrEqual(expectedDelay);
    expect(await worker.claimNextJob()).toBeNull();
    expect(await db.one('SELECT COUNT(*) n FROM staged_evaluations')).toEqual({n:0});
  });
  it.each([false,true])('releases enrichment-ready work into the staged-v8 queue with existing job=%s', async existing => {
    await enrichment('version','1.0.0','RUNNING');
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    if (!existing) await db.execute('DELETE FROM evaluation_jobs');
    await db.execute(`UPDATE enrichment_jobs SET status='COMPLETE' WHERE canonical_job_id='job' AND opportunity_version='version' AND pipeline_version='1.0.0'`);
    await new EnrichmentQueue(db).releaseEvaluationRequirements('job','version');
    expect(await state()).toMatchObject({status:'staged_pending',requirement:'READY'});
    expect((await new EvaluationWorker(db).claimNextJob())?.evaluationContextFingerprint).toBe('staged-context');
  });
  it('does not release a different opportunity or pipeline dependency', async () => {
    await enrichment('version','1.0.0','RUNNING');
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    await enrichment('other-version');
    await enrichment('version','2.0.0');
    const queue = new EnrichmentQueue(db);
    expect(await queue.releaseEvaluationRequirements('job','other-version')).toBe(0);
    expect(await queue.releaseEvaluationRequirements('job','version','2.0.0')).toBe(0);
    expect(await db.one(`SELECT status,blocked_reason FROM evaluation_requirements`)).toEqual({status:'WAITING_ENRICHMENT',blocked_reason:null});
    expect(await db.one(`SELECT COUNT(*) n FROM evaluation_jobs`)).toEqual({n:1});
    expect(await state()).toMatchObject({status:'staged_waiting_enrichment',requirement:'WAITING_ENRICHMENT'});
    expect(await new EvaluationWorker(db).claimNextJob()).toBeNull();
  });
  it('does not manufacture an evaluation obligation when exact enrichment work is absent', async () => {
    expect(await new EvaluationWorkScheduler(db).ensureWork(identity)).toMatchObject({
      jobId:null,
      queued:false,
      requirementStatus:'NO_ENRICHMENT',
    });
    expect(await db.one(`SELECT COUNT(*) n FROM evaluation_requirements`)).toEqual({n:0});
    expect(await db.one(`SELECT COUNT(*) n FROM evaluation_jobs`)).toEqual({n:0});
  });
  it('prunes a historical waiting requirement that has no exact enrichment work', async () => {
    await db.execute(`INSERT INTO evaluation_requirements(
      id,tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,
      evaluation_context_fingerprint,status,required_enrichment_pipeline_version
    ) VALUES('orphan','tenant_A','person_A','plan_A','job','version','staged-context','WAITING_ENRICHMENT','1.0.0')`);
    expect(await new RunReconciliationService(db).repairDanglingWork()).toMatchObject({requirementsHealed:1});
    expect(await db.one(`SELECT COUNT(*) n FROM evaluation_requirements`)).toEqual({n:0});
    expect(await db.one(`SELECT COUNT(*) n FROM evaluation_jobs`)).toEqual({n:0});
  });
  it('fails both dependency rows when enrichment permanently fails', async () => {
    await enrichment('version','1.0.0','RUNNING');
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    await new EnrichmentQueue(db).failEvaluationRequirements('job','version');
    expect(await state()).toMatchObject({status:'staged_dead_letter',requirement:'FAILED',blocked_reason:'ENRICHMENT_FAILED'});
  });
  it('claims the newest projected version and prunes superseded non-completed work', async () => {
    await db.execute(`UPDATE opportunity_versions
      SET acquisition_status='ACQUIRED',lifecycle_state='ACTIVE',created_at='2026-01-01 00:00:00'
      WHERE id='version'`);
    await enrichment();
    await new EvaluationWorkScheduler(db).ensureWork(identity);

    const newerVersion='version-new';
    const newerContent='Updated complete job description with materially corrected source evidence';
    await db.execute(`INSERT INTO opportunity_versions(
      id,canonical_job_id,content_hash,job_title,raw_content,acquisition_status,lifecycle_state,created_at
    ) VALUES (?,?,?,?,?,'ACQUIRED','ACTIVE','2026-09-27 00:00:00')`,[
      newerVersion,
      'job',
      computeContentHash({title:'Head of Growth',companyName:null,location:null,employmentType:null,rawContent:newerContent}),
      'Head of Growth',
      newerContent,
    ]);
    await db.execute(`INSERT INTO search_plan_candidates(
      tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision
    ) VALUES ('tenant_A','person_A','plan_A','job',?,'CANDIDATE')`,[newerVersion]);
    await enrichment(newerVersion);
    await new EvaluationWorkScheduler(db).ensureWork({...identity,opportunityVersion:newerVersion});

    const worker=new EvaluationWorker(db);
    expect((await worker.claimNextJob())?.opportunityVersion).toBe(newerVersion);

    await new RunReconciliationService(db).repairDanglingWork();
    expect(await db.one(`SELECT COUNT(*) n FROM evaluation_jobs WHERE opportunity_version='version'`)).toEqual({n:0});
    expect(await db.one(`SELECT COUNT(*) n FROM evaluation_requirements WHERE opportunity_version='version'`)).toEqual({n:0});
    expect(await db.one(`SELECT status FROM evaluation_jobs WHERE opportunity_version=?`,[newerVersion])).toEqual({status:'staged_processing'});
    expect(await db.one(`SELECT status FROM evaluation_requirements WHERE opportunity_version=?`,[newerVersion])).toEqual({status:'READY'});
  });
  it('reconciliation creates a missing staged-v8 queue row', async () => {
    await enrichment();
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    await db.execute('DELETE FROM evaluation_jobs');
    await new RunReconciliationService(db).repairDanglingWork();
    expect(await state()).toMatchObject({status:'staged_pending',requirement:'READY'});
  });
  it('never releases waiting work before the exact enrichment completes',async()=>{
    await enrichment('version','1.0.0','RUNNING');
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    expect(await new EnrichmentQueue(db).releaseEvaluationRequirements('job','version')).toBe(0);
    expect(await state()).toMatchObject({status:'staged_waiting_enrichment',requirement:'WAITING_ENRICHMENT'});
  });
});
