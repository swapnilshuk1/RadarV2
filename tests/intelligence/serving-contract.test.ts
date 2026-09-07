import { expect, test, describe, beforeAll } from 'vitest';
import { SqliteAdapter } from '../../src/data/database/sqlite';
import Database from 'better-sqlite3';
import { SqliteOpportunityQueries } from '../../src/data/sqlite/repositories/SqliteOpportunityQueries';
import { SqliteEvaluationContextStore } from '../../src/data/sqlite/repositories/SqliteEvaluationContextStore';
import { setupLineageTestFixture } from '../persistence/lineage_fixture';

describe('Phase 4 Serving Contract', () => {
  let db: any;
  let opportunityQueries: SqliteOpportunityQueries;
  const scope = { tenantId: 'tenant_A', personId: 'person_A' };
  
  beforeAll(async () => {
    const rawDb = new Database(':memory:');
    db = new SqliteAdapter(rawDb);
    await setupLineageTestFixture(db);
    await db.execute(`INSERT INTO users (id, email) VALUES ('person_A', 'person_a@test.local')`);
    await db.execute(`INSERT INTO memberships (user_id, tenant_id, role, status, permissions) VALUES ('person_A', 'tenant_A', 'member', 'active', '[]')`);
    opportunityQueries = new SqliteOpportunityQueries(db);
    const contextStore = new SqliteEvaluationContextStore(db);
    await contextStore.bindEvaluationContextScope('fingerprint_A', 'tenant_A', 'person_A', 'plan_A');
    await contextStore.activateContextPointer('fingerprint_A', 'tenant_A', 'person_A', 'plan_A');

    // Setup base canonical data for Candidate 1
    await db.execute("INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES ('canon-1', 'LinkedIn', 'hash-1', 'url', 'Company A')");
    await db.execute("INSERT INTO opportunity_versions (id, canonical_job_id, job_title, location, employment_type, raw_content, posted_at, posted_precision, content_hash, lifecycle_state) VALUES ('ov-1', 'canon-1', 'CEO', 'Remote', 'Full-time', 'content', '2023-01-01', 'day', 'hash-1', 'ACTIVE')");
    
    // Candidate 1: Unmaterialized
    await db.execute("INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES ('tenant_A', 'person_A', 'plan_A', 'canon-1', 'ov-1', 'CANDIDATE')");

    // Candidate 2: Unavailable (SPARSE_SPEC)
    await db.execute("INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES ('canon-2', 'LinkedIn', 'hash-2', 'url', 'Company B')");
    await db.execute("INSERT INTO opportunity_versions (id, canonical_job_id, job_title, location, employment_type, raw_content, posted_at, posted_precision, content_hash, lifecycle_state) VALUES ('ov-2', 'canon-2', 'CTO', 'Remote', 'Full-time', 'content', '2023-01-01', 'day', 'hash-2', 'ACTIVE')");
    await db.execute("INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES ('tenant_A', 'person_A', 'plan_A', 'canon-2', 'ov-2', 'CANDIDATE')");
    await db.execute("INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, evaluation_state, evaluation_json) VALUES ('me-2', 'tenant_A', 'person_A', 'canon-2', 'ov-2', 'fingerprint_A', 'SPARSE_SPEC', '{}')");

    // Candidate 3: Wrong context materialization
    await db.execute("INSERT INTO search_plan_snapshots (id, tenant_id, person_id, search_plan_id, snapshot_hash, payload_json) VALUES ('sps_wrong', 'tenant_A', 'person_A', 'plan_A', 'hashW', '{}')");
    await db.execute("INSERT INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES ('ctx-wrong', 'tenant_A', 'person_A', 'sps_wrong', 'v1', 'hashW', 'v1', 'v1')");
    await db.execute("INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name) VALUES ('canon-3', 'LinkedIn', 'hash-3', 'url', 'Company C')");
    await db.execute("INSERT INTO opportunity_versions (id, canonical_job_id, job_title, location, employment_type, raw_content, posted_at, posted_precision, content_hash, lifecycle_state) VALUES ('ov-3', 'canon-3', 'CFO', 'Remote', 'Full-time', 'content', '2023-01-01', 'day', 'hash-3', 'ACTIVE')");
    await db.execute("INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES ('tenant_A', 'person_A', 'plan_A', 'canon-3', 'ov-3', 'CANDIDATE')");
    await db.execute("INSERT INTO materialized_evaluations (id, tenant_id, person_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint, evaluation_state, evaluation_json) VALUES ('me-3', 'tenant_A', 'person_A', 'canon-3', 'ov-3', 'ctx-wrong', 'EVALUATED', '{}')");
  });

  test('listOpportunities visibility and mapping', async () => {
    const opps = (await opportunityQueries.getFeed(scope, undefined, undefined, 24)).items;
    expect(opps.length).toBe(3);

    const unmat = opps.find((o: any) => o.jobHash === 'hash-1');
    expect(unmat).toBeDefined();
    expect(unmat.evaluationState).toBe('UNMATERIALIZED');

    const unavail = opps.find((o: any) => o.jobHash === 'hash-2');
    expect(unavail).toBeDefined();
    expect(unavail.evaluationState).toBe('SPARSE_SPEC');

    const wrongCtx = opps.find((o: any) => o.jobHash === 'hash-3');
    expect(wrongCtx).toBeDefined();
    expect(wrongCtx.evaluationState).toBe('UNMATERIALIZED');
  });

  test('getOpportunity visibility and mapping', async () => {
    const items = (await opportunityQueries.getFeed(scope, undefined, undefined, 24)).items;
    const unmat = items.find((opportunity) => opportunity.jobHash === 'hash-1');
    expect(unmat).toBeDefined();
    expect(unmat?.evaluationState).toBe('UNMATERIALIZED');

    const unavail = items.find((opportunity) => opportunity.jobHash === 'hash-2');
    expect(unavail).toBeDefined();
    expect(unavail?.evaluationState).toBe('SPARSE_SPEC');

    const wrongCtx = items.find((opportunity) => opportunity.jobHash === 'hash-3');
    expect(wrongCtx).toBeDefined();
    expect(wrongCtx?.evaluationState).toBe('UNMATERIALIZED');
  });
});
