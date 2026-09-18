import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelProviderUnavailableError } from '../../src/lib/model/provider-unavailable';
import { ProductionStagedEvaluationService } from '../../src/lib/intelligence/staged/ProductionStagedEvaluationService';
import { ProductionStagedDossierService } from '../../src/lib/intelligence/staged/ProductionStagedDossierService';
import { StagedServingPublisher } from '../../src/lib/intelligence/staged/StagedServingPublisher';
import {recoverStagedProviderFailures} from '../../src/lib/intelligence/staged/StagedProviderRecovery';
import { SqliteAdapter } from '../../src/data/database/sqlite';
import { setupLineageTestFixture } from '../persistence/lineage_fixture';
import { EvaluationWorkScheduler } from '../../src/lib/intelligence/EvaluationWorkScheduler';
import { EvaluationWorker } from '../../src/lib/intelligence/EvaluationWorker';
import { EnrichmentQueue } from '../../scripts/scraper/persist/queue';
import { RunReconciliationService } from '../../src/lib/intelligence/RunReconciliationService';
import { selectUnscheduledStagedCandidates } from '../../src/lib/intelligence/staged/backfillSelection';
import { MissingEnrichmentRecovery } from '../../src/lib/intelligence/staged/MissingEnrichmentRecovery';
import { computeContentHash } from '../../src/lib/domain/canonical_identity';
import type { BlobStore } from '../../src/lib/storage/blob-store';

describe('staged enrichment dependency lifecycle', () => {
  let db: SqliteAdapter;
  const identity = {tenantId:'tenant_A',personId:'person_A',searchPlanId:'plan_A',canonicalJobId:'job',opportunityVersion:'version',evaluationContextFingerprint:'staged-context'};
  beforeEach(async () => {
    db = new SqliteAdapter(new Database(':memory:'));
    await setupLineageTestFixture(db);
    await db.execute(`INSERT INTO evaluation_contexts (context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,ontology_version,ontology_fingerprint,policy_version,profile_version) VALUES ('staged-context','tenant_A','person_A','sps_A','v1','hash_ontology','staged-v6','profile')`);
    await db.execute(`INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url) VALUES ('job','LinkedIn','source-job','https://example.com/job')`);
    await db.execute(`INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,raw_content) VALUES ('version','job',?,'Head of Growth','Job description')`,[computeContentHash({title:'Head of Growth',companyName:null,location:null,employmentType:null,rawContent:'Job description'})]);
    await db.execute(`INSERT INTO search_plan_candidates(tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision) VALUES ('tenant_A','person_A','plan_A','job','version','CANDIDATE')`);
  });
  async function enrichment(version='version',pipeline='1.0.0',status='COMPLETE') {
    await db.execute(`INSERT INTO enrichment_jobs(id,job_hash,canonical_job_id,opportunity_version,pipeline_version,status) VALUES (?,?,?,?,?,?)`,[`enrich-${version}-${pipeline}`,'job','job',version,pipeline,status]);
  }
  async function state() {
    return db.one<{status:string;requirement:string;blocked_reason:string|null}>(`SELECT ej.status,er.status AS requirement,er.blocked_reason FROM evaluation_jobs ej JOIN evaluation_requirements er ON er.evaluation_context_fingerprint=ej.evaluation_context_fingerprint`);
  }
  it.each(['PURSUE','CONSIDER','PASS'] as const)('completes %s while composing only actionable active-context results',async decision=>{
    await db.execute(`UPDATE opportunity_versions SET acquisition_status='ACQUIRED',lifecycle_state='ACTIVE'`);
    await enrichment();await new EvaluationWorkScheduler(db).ensureWork(identity);
    await db.execute(`INSERT OR IGNORE INTO evaluation_context_scopes(context_fingerprint,tenant_id,person_id,search_plan_id) VALUES('staged-context','tenant_A','person_A','plan_A')`);
    await db.execute(`INSERT INTO active_evaluation_contexts(tenant_id,person_id,search_plan_id,context_fingerprint,activated_by) VALUES('tenant_A','person_A','plan_A','staged-context','test-fixture')`);
    const worker=new EvaluationWorker(db);const job=await worker.claimNextJob('staged');
    const evaluate=vi.spyOn(ProductionStagedEvaluationService.prototype,'evaluate').mockResolvedValue({decision} as any);
    const compose=vi.spyOn(ProductionStagedDossierService.prototype,'compose').mockResolvedValue({} as any);
    const publish=vi.spyOn(StagedServingPublisher.prototype,'publish').mockResolvedValue(undefined as any);
    try{
      expect(await worker.processJob(job!)).toMatchObject({status:'completed',decision});
      expect(compose).toHaveBeenCalledTimes(decision==='PASS'?0:1);
      expect(publish).toHaveBeenCalledTimes(decision==='PASS'?0:1);
      expect(await state()).toMatchObject({status:'staged_completed',requirement:'SATISFIED'});
    }finally{evaluate.mockRestore();compose.mockRestore();publish.mockRestore();}
  });
  it.each([[403,900_000],[429,45_000]])('releases the owned lease with provider-specific delay for HTTP %s without spending attempts',async(httpStatus,retryAfterMs)=>{
    await db.execute(`UPDATE opportunity_versions SET acquisition_status='ACQUIRED',lifecycle_state='ACTIVE'`);
    await enrichment();await new EvaluationWorkScheduler(db).ensureWork(identity);
    const worker=new EvaluationWorker(db);const job=await worker.claimNextJob('staged');
    const error=new ModelProviderUnavailableError(`Provider HTTP ${httpStatus}`,httpStatus,retryAfterMs);
    const evaluation=vi.spyOn(ProductionStagedEvaluationService.prototype,'evaluate').mockRejectedValue(error);
    try{await expect(worker.processJob(job!)).rejects.toBe(error);}finally{evaluation.mockRestore();}
    expect(await state()).toMatchObject({status:'staged_pending',requirement:'READY'});
    expect(await db.one('SELECT attempts,locked_by,lease_token FROM evaluation_jobs')).toEqual({attempts:0,locked_by:null,lease_token:null});
    const delay=await db.one<{seconds:number}>(`SELECT CAST(strftime('%s',next_attempt_at)-strftime('%s','now') AS INTEGER) AS seconds FROM evaluation_jobs`);
    expect(delay!.seconds).toBeGreaterThanOrEqual(retryAfterMs/1000-2);expect(delay!.seconds).toBeLessThanOrEqual(retryAfterMs/1000);
    expect(await worker.claimNextJob('staged')).toBeNull();
    expect(await db.one('SELECT COUNT(*) n FROM staged_evaluations')).toEqual({n:0});
  });
  it('recovers only scoped provider dead letters and retains the original failure',async()=>{
    await db.execute(`UPDATE opportunity_versions SET acquisition_status='ACQUIRED',lifecycle_state='ACTIVE'`);
    await enrichment();await new EvaluationWorkScheduler(db).ensureWork(identity);
    await db.execute(`UPDATE evaluation_jobs SET status='staged_dead_letter',attempts=3,last_error='Bedrock provider HTTP 403'`);
    await db.execute(`UPDATE evaluation_requirements SET status='FAILED',blocked_reason='EVALUATION_DEAD_LETTER:Bedrock provider HTTP 403'`);
    const scope={...identity,contextFingerprint:identity.evaluationContextFingerprint};
    expect(await recoverStagedProviderFailures(db,{...scope,personId:'other'},10,true)).toEqual([]);
    expect(await recoverStagedProviderFailures(db,scope,10)).toHaveLength(1);
    expect(await state()).toMatchObject({status:'staged_dead_letter',requirement:'FAILED'});
    expect(await recoverStagedProviderFailures(db,scope,10,true)).toHaveLength(1);
    expect(await state()).toMatchObject({status:'staged_pending',requirement:'READY'});
    expect(await recoverStagedProviderFailures(db,scope,10,true)).toEqual([]);
    const audit=await db.one<{details:string}>(`SELECT details FROM enrichment_events WHERE event_type='EVALUATION_PROVIDER_FAILURE_RECOVERED'`);
    expect(JSON.parse(audit!.details)).toMatchObject({attempts:3,last_error:'Bedrock provider HTTP 403',previousRequirementStatus:'FAILED'});
  });
  it.each([false,true])('releases v6 into staged queue with existing job=%s', async existing => {
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    if (!existing) await db.execute('DELETE FROM evaluation_jobs');
    await enrichment();
    await new EnrichmentQueue(db).releaseEvaluationRequirements('job','version');
    expect(await state()).toMatchObject({status:'staged_pending',requirement:'READY'});
    expect((await new EvaluationWorker(db).claimNextJob('staged'))?.evaluationContextFingerprint).toBe('staged-context');
  });
  it('does not release a different opportunity or pipeline dependency', async () => {
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    await enrichment('other-version');
    await enrichment('version','2.0.0');
    const queue = new EnrichmentQueue(db);
    expect(await queue.releaseEvaluationRequirements('job','other-version')).toBe(0);
    expect(await queue.releaseEvaluationRequirements('job','version','2.0.0')).toBe(0);
    expect(await state()).toMatchObject({status:'staged_waiting_enrichment',requirement:'WAITING_ENRICHMENT'});
    expect(await new EvaluationWorker(db).claimNextJob()).toBeNull();
  });
  it('reconciles a missing dependency to a matching terminal queue state without resurrection', async () => {
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    await new RunReconciliationService(db).repairDanglingWork();
    expect(await state()).toMatchObject({status:'staged_dead_letter',requirement:'FAILED',blocked_reason:'MISSING_ENRICHMENT_JOB'});
    await enrichment();
    expect(await new EnrichmentQueue(db).releaseEvaluationRequirements('job','version')).toBe(0);
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    expect(await state()).toMatchObject({status:'staged_dead_letter',requirement:'FAILED'});
  });
  it('fails both dependency rows when enrichment permanently fails', async () => {
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    await new EnrichmentQueue(db).failEvaluationRequirements('job','version');
    expect(await state()).toMatchObject({status:'staged_dead_letter',requirement:'FAILED',blocked_reason:'ENRICHMENT_FAILED'});
  });
  it('reconciliation creates a missing v6 queue row in the staged family', async () => {
    await enrichment();
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    await db.execute('DELETE FROM evaluation_jobs');
    await new RunReconciliationService(db).repairDanglingWork();
    expect(await state()).toMatchObject({status:'staged_pending',requirement:'READY'});
  });
  it('backfill skips existing work and preserves terminal requirements', async () => {
    await db.execute(`UPDATE opportunity_versions SET lifecycle_state='ACTIVE',acquisition_status='ACQUIRED'`);
    const selection={...identity,contextFingerprint:identity.evaluationContextFingerprint,limit:1};
    expect(await selectUnscheduledStagedCandidates(db,selection)).toHaveLength(1);
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    expect(await selectUnscheduledStagedCandidates(db,selection)).toHaveLength(0);
    await new RunReconciliationService(db).repairDanglingWork();
    expect(await selectUnscheduledStagedCandidates(db,selection)).toHaveLength(0);
  });
  it('ready-only backfill excludes missing enrichment and an explicitly identified bad capture',async()=>{
    await db.execute(`UPDATE opportunity_versions SET lifecycle_state='ACTIVE',acquisition_status='ACQUIRED'`);
    const selection={...identity,contextFingerprint:identity.evaluationContextFingerprint,limit:1,readyOnly:true};
    expect(await selectUnscheduledStagedCandidates(db,selection)).toHaveLength(0);
    await enrichment();
    expect(await selectUnscheduledStagedCandidates(db,selection)).toHaveLength(1);
    expect(await selectUnscheduledStagedCandidates(db,{...selection,excludeSourceVersion:'version'})).toHaveLength(0);
  });
  it('never releases waiting work before the exact enrichment completes',async()=>{
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    await enrichment('version','1.0.0','RUNNING');
    expect(await new EnrichmentQueue(db).releaseEvaluationRequirements('job','version')).toBe(0);
    expect(await state()).toMatchObject({status:'staged_waiting_enrichment',requirement:'WAITING_ENRICHMENT'});
  });
  it('explicitly recovers a missing dependency only after completion and retains the previous failure in audit',async()=>{
    const contentHash=computeContentHash({title:'Head of Growth',companyName:null,location:null,employmentType:null,rawContent:'Job description'});
    await db.execute(`UPDATE opportunity_versions SET lifecycle_state='ACTIVE',acquisition_status='ACQUIRED'`);
    await new EvaluationWorkScheduler(db).ensureWork(identity);
    await new RunReconciliationService(db).repairDanglingWork();
    const payloads=new Map<string,Buffer>();
    const blobs={get:async(key:string)=>payloads.get(key)||null,put:async(key:string,value:string)=>{payloads.set(key,Buffer.from(value));return key;}} as BlobStore;
    const recovery=new MissingEnrichmentRecovery(db,blobs);
    const scope={...identity,contextFingerprint:identity.evaluationContextFingerprint};
    const versions=await recovery.select(scope,10);
    expect(versions).toHaveLength(1);
    const enqueued=await recovery.enqueue(versions[0]);
    expect(enqueued.created).toBe(true);
    expect(JSON.parse(payloads.get(enqueued.payloadKey)!.toString()).evaluationEvidence).toMatchObject({canonicalJobId:'job',opportunityVersion:'version',contentHash});
    expect(await recovery.recoverCompletedDependencies(scope)).toBe(0);
    await db.execute(`UPDATE enrichment_jobs SET status='COMPLETE' WHERE id=?`,[enqueued.jobId]);
    expect(await recovery.recoverCompletedDependencies({...scope,personId:'other'})).toBe(0);
    expect(await recovery.recoverCompletedDependencies(scope)).toBe(1);
    expect(await recovery.recoverCompletedDependencies(scope)).toBe(0);
    expect(await state()).toMatchObject({status:'staged_pending',requirement:'READY',blocked_reason:null});
    const audit=await db.one<{details:string}>(`SELECT details FROM enrichment_events WHERE event_type='EVALUATION_DEPENDENCY_RECOVERED'`);
    expect(JSON.parse(audit!.details)).toMatchObject({previousRequirementStatus:'FAILED',previousBlockedReason:'MISSING_ENRICHMENT_JOB',job_status:'staged_dead_letter'});
  });
});
