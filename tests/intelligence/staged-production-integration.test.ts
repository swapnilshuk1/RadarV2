import { describe, expect, it } from 'vitest';
import { getDatabaseAdapter } from '../../src/data/database';
import { runMigrations } from '../../src/data/sqlite/migrations/runner';
import { SqliteStagedEvaluationStore, STAGED_CONTRACT_VERSION, STAGED_POLICY_VERSION, stagedUnavailableEvaluation } from '../../src/data/sqlite/repositories/SqliteStagedEvaluationStore';
import { assertCanonicalJdContentHash, DeterministicStagedInputUnavailableError } from '../../src/lib/intelligence/staged/ProductionStagedInputAdapter';
import { computeContentHash } from '../../src/lib/domain/canonical_identity';
import {stagedEvaluation} from '../fixtures/staged-rich-dossier';

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
  it('keys cached source evidence by immutable fingerprint and extraction model identity', async () => {
    const db=getDatabaseAdapter(':memory:'); await runMigrations(db); const store=new SqliteStagedEvaluationStore(db);
    await store.cacheClaims({sourceFingerprint:'content-a',modelId:'bedrock-converse',modelVersion:'zai.glm-5'},{id:'jd-a'},[{id:'JD-1-1'}]);
    expect(await store.cachedClaims({sourceFingerprint:'content-a',modelId:'bedrock-converse',modelVersion:'zai.glm-5'})).toEqual([{id:'JD-1-1'}]);
    expect(await store.cachedClaims({sourceFingerprint:'content-b',modelId:'bedrock-converse',modelVersion:'zai.glm-5'})).toBeUndefined();
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
