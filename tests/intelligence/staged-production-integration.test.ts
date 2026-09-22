import { describe, expect, it } from 'vitest';
import { getDatabaseAdapter } from '../../src/data/database';
import { runMigrations } from '../../src/data/sqlite/migrations/runner';
import { SqliteStagedEvaluationStore, STAGED_CONTRACT_VERSION, STAGED_POLICY_VERSION, stagedUnavailableEvaluation } from '../../src/data/sqlite/repositories/SqliteStagedEvaluationStore';
import { assertCanonicalJdContentHash, DeterministicStagedInputUnavailableError } from '../../src/lib/intelligence/staged/ProductionStagedInputAdapter';
import { computeContentHash } from '../../src/lib/domain/canonical_identity';
import {stagedEvaluation} from '../fixtures/staged-rich-dossier';
import { durableStagedModel } from '../../src/lib/intelligence/staged/DurableStagedModel';
import { createSqliteModelInvocationSink } from '../../src/lib/model/model-invocation';

describe('staged production persistence boundary', () => {
  it('uses a fresh staged policy and contract identity for post-fix evaluations', () => {
    expect(STAGED_POLICY_VERSION).toBe('staged-v8');
    expect(STAGED_CONTRACT_VERSION).toBe('staged-decision-v8');
  });
  it('persists a versioned staged result without fabricating an intrinsic score and is idempotent', async () => {
    const db=getDatabaseAdapter(':memory:'); await runMigrations(db);
    const store=new SqliteStagedEvaluationStore(db);
    const identity={tenantId:'tenant',personId:'person',canonicalJobId:'job',opportunityVersion:'version',evaluationContextFingerprint:'context',profileVersion:'profile',policyVersion:STAGED_POLICY_VERSION,ontologyVersion:'ontology',ontologyFingerprint:'ontology-hash'};
    const record={...identity,jobHash:'job',inputFingerprint:'input',sourceFingerprints:['JD:source'],modelId:'bedrock-converse',modelVersion:'zai.glm-5',contractVersion:STAGED_CONTRACT_VERSION,evaluationState:'COMPLETED' as const,decision:stagedEvaluation.decision.verdict,screeningViability:stagedEvaluation.decision.screeningViability,evaluation:stagedEvaluation,evaluatedAt:'2026-01-01T00:00:00.000Z'};
    await expect(store.save({...record,evaluation:{decision:{verdict:'PURSUE'}}})).rejects.toThrow();
    expect(await store.get(identity)).toBeUndefined();
    await store.save(record); await store.save(record);
    await expect(store.save({...record,decision:'PASS'})).rejects.toThrow('STAGED_PERSISTED_DECISION_MISMATCH');
    const read=await store.get(identity); expect(read?.decision).toBe('PURSUE'); expect(read?.evaluationState).toBe('COMPLETED');
    const legacy=await db.one<{count:number}>('SELECT COUNT(*) AS count FROM materialized_evaluations'); expect(legacy?.count).toBe(0);
  });
  it('keys cached source evidence by immutable fingerprint and exact model configuration identity', async () => {
    const db=getDatabaseAdapter(':memory:'); await runMigrations(db); const store=new SqliteStagedEvaluationStore(db);
    await store.cacheClaims({sourceFingerprint:'content-a',modelId:'bedrock-converse',modelVersion:'zai.glm-5',modelConfigurationFingerprint:'config-a'},{id:'jd-a'},[{id:'JD-1-1'}]);
    expect(await store.cachedClaims({sourceFingerprint:'content-a',modelId:'bedrock-converse',modelVersion:'zai.glm-5',modelConfigurationFingerprint:'config-a'})).toEqual([{id:'JD-1-1'}]);
    expect(await store.cachedClaims({sourceFingerprint:'content-a',modelId:'bedrock-converse',modelVersion:'zai.glm-5',modelConfigurationFingerprint:'config-b'})).toBeUndefined();
    expect(await store.cachedClaims({sourceFingerprint:'content-b',modelId:'bedrock-converse',modelVersion:'zai.glm-5',modelConfigurationFingerprint:'config-a'})).toBeUndefined();
  });
  it('reuses validated semantic checkpoints across worker restarts but not across model configurations', async () => {
    const db=getDatabaseAdapter(':memory:'); await runMigrations(db);
    let calls=0;
    const makeModel=(configurationFingerprint:string)=>({
      id:'bedrock-mantle',
      version:'zai.glm-5',
      configurationFingerprint,
      async generate(){calls++;return {value:'accepted'};},
    });
    const first=durableStagedModel(db,'scope',makeModel('config-a'));
    expect(await first.generate('stage instruction',{stable:true},undefined,{stage:'decision',attempt:1})).toEqual({value:'accepted'});
    expect(calls).toBe(1);
    const restarted=durableStagedModel(db,'scope',makeModel('config-a'));
    expect(await restarted.generate('stage instruction',{stable:true},undefined,{stage:'decision',attempt:1})).toEqual({value:'accepted'});
    expect(calls).toBe(1);
    const reconfigured=durableStagedModel(db,'scope',makeModel('config-b'));
    expect(await reconfigured.generate('stage instruction',{stable:true},undefined,{stage:'decision',attempt:1})).toEqual({value:'accepted'});
    expect(calls).toBe(2);
  });
  it('persists exact per-request usage and latency against the owning evaluation job', async () => {
    const db=getDatabaseAdapter(':memory:'); await runMigrations(db);
    const sink=createSqliteModelInvocationSink(db,{
      pipeline:'evaluation',
      evaluationJobId:'eval-job',
      tenantId:'tenant',
      personId:'person',
      canonicalJobId:'job',
      opportunityVersion:'version',
      evaluationContextFingerprint:'context',
    });
    const invocationId='invocation-1';
    await sink({
      invocationId,
      provider:'bedrock-mantle',
      modelId:'bedrock-mantle',
      modelVersion:'zai.glm-5',
      modelConfigurationFingerprint:'config',
      requestFingerprint:'request',
      stage:'decision',
      attempt:1,
      maxOutputTokens:4096,
      startedAt:1000,
      status:'running',
    });
    expect(await db.one<any>('SELECT status,completed_at FROM model_invocations')).toEqual({
      status:'running',
      completed_at:null,
    });
    await sink({
      invocationId,
      provider:'bedrock-mantle',
      modelId:'bedrock-mantle',
      modelVersion:'zai.glm-5',
      modelConfigurationFingerprint:'config',
      requestFingerprint:'request',
      stage:'decision',
      attempt:1,
      maxOutputTokens:4096,
      startedAt:1000,
      completedAt:1125,
      finishReason:'stop',
      status:'completed',
      usage:{
        inputTokens:100,
        cachedInputTokens:40,
        outputTokens:25,
        reasoningTokens:7,
        totalTokens:125,
      },
    });
    const row=await db.one<any>('SELECT * FROM model_invocations');
    expect(row).toMatchObject({
      evaluation_job_id:'eval-job',
      pipeline:'evaluation',
      stage:'decision',
      attempt:1,
      provider:'bedrock-mantle',
      model_version:'zai.glm-5',
      model_configuration_fingerprint:'config',
      request_fingerprint:'request',
      max_output_tokens:4096,
      started_at:1000,
      completed_at:1125,
      latency_ms:125,
      input_tokens:100,
      cached_input_tokens:40,
      output_tokens:25,
      reasoning_tokens:7,
      total_tokens:125,
      status:'completed',
    });
  });

  it('records input-unavailable state without pretending to produce a decision', () => {
    const row=stagedUnavailableEvaluation({tenantId:'t',personId:'p',canonicalJobId:'j',opportunityVersion:'v',evaluationContextFingerprint:'c',profileVersion:'pv',policyVersion:STAGED_POLICY_VERSION,ontologyVersion:'o',ontologyFingerprint:'oh'},'PROFILE_SOURCE_PROVENANCE_MISSING');
    expect(row.evaluationState).toBe('INPUT_UNAVAILABLE'); expect(row.decision).toBeUndefined(); expect(row.blockedReason).toBe('PROFILE_SOURCE_PROVENANCE_MISSING');
  });
  it('fails closed when stored JD content no longer matches its canonical hash', () => {
    const version={raw_content:'Immutable role text',job_title:'Head of Growth',company_name:'Example Co',location:'Delhi',employment_type:'Full-time',content_hash:computeContentHash({title:'Head of Growth',companyName:'Example Co',location:'Delhi',employmentType:'Full-time',rawContent:'Immutable role text'})};
    expect(()=>assertCanonicalJdContentHash(version)).not.toThrow();
    expect(()=>assertCanonicalJdContentHash({...version,raw_content:'Altered role text'})).toThrow(DeterministicStagedInputUnavailableError);
    expect(()=>assertCanonicalJdContentHash({...version,raw_content:'Altered role text'})).toThrow('CANONICAL_JD_HASH_MISMATCH');
  });
});