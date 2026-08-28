import { getDatabaseAdapter } from "../../src/data/database/index";

export async function seedMetricsData(personId = "guest-user") {
  const db = getDatabaseAdapter();
  const tenantId = `tenant_${personId}`;
  
  await db.execute(`INSERT OR IGNORE INTO tenants (id, status) VALUES (?, 'active')`, [tenantId]);
  await db.execute(`INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)`, [personId, `${personId}@example.com`]);
  await db.execute(`INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, permissions, status) VALUES (?, ?, 'user', '[]', 'active')`, [personId, tenantId]);
  await db.execute(`INSERT OR IGNORE INTO people (id, email, name, role, onboarded, email_verified, tenant_id) VALUES (?, ?, 'Test', 'user', 1, 1, ?)`, [personId, `${personId}@example.com`, tenantId]);
  await db.execute(`INSERT OR IGNORE INTO search_plans (id, tenant_id, person_id, title, status, criteria_json) VALUES (?, ?, ?, 'Plan', 'active', '{}')`, [`sp_${personId}`, tenantId, personId]);
  await db.execute(`INSERT OR IGNORE INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, 'hash', '{}')`, [`snap_${personId}`, `sp_${personId}`, tenantId, personId]);
  await db.execute(`INSERT OR IGNORE INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES (?, ?, ?, ?, '3.0.0', 'of1', 'v4.1', '1.0')`, [`ctx_${personId}`, tenantId, personId, `snap_${personId}`]);

  await db.execute(`INSERT OR IGNORE INTO evaluation_context_scopes (tenant_id, person_id, search_plan_id, context_fingerprint) VALUES (?, ?, ?, ?)`, [tenantId, personId, `sp_${personId}`, `ctx_${personId}`]);
  await db.execute(`INSERT OR IGNORE INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by) VALUES (?, ?, ?, ?, ?)`, [tenantId, personId, `sp_${personId}`, `ctx_${personId}`, personId]);
  
  const items = [];
  for (let i=0; i<4; i++) items.push("PURSUE"); // 4 pursue
  for (let i=0; i<3; i++) items.push("CONSIDER"); // 3 consider
  for (let i=0; i<3; i++) items.push("PASS"); // 3 pass
  
  await db.transaction(async (tx) => {
    await tx.execute(`INSERT OR IGNORE INTO companies (id, name, industry) VALUES ('comp1', 'Test', 'tech')`);
    
    for (let i=0; i<items.length; i++) {
        const jobHash = `job_${personId}_${i}`;
        const verdict = items[i];
        
        await tx.execute(`INSERT OR IGNORE INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES (?, 'test', ?, 'http')`, [jobHash, jobHash]);
        await tx.execute(`INSERT OR IGNORE INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content) VALUES (?, ?, 'ch1', 'Dir', 'raw')`, [`v_${jobHash}`, jobHash]);
        await tx.execute(`INSERT OR IGNORE INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, ?, 'CANDIDATE')`, [tenantId, personId, `sp_${personId}`, jobHash, `v_${jobHash}`]);
        
        // Serve path reads from materialized_evaluations
        await tx.execute(`INSERT OR IGNORE INTO materialized_evaluations 
          (canonical_job_id, opportunity_version, tenant_id, person_id, evaluation_context_fingerprint, evaluation_state, decision, quality_score, rationale, evidence_ids, evaluation_json) 
          VALUES (?, ?, ?, ?, ?, 'EVALUATED', ?, 80, 'rationale', '[]', ?)`, 
          [jobHash, `v_${jobHash}`, tenantId, personId, `ctx_${personId}`, verdict, JSON.stringify({ jobHash: jobHash, intrinsicVerdict: verdict, intrinsicQualityScore: 90, schemaVersion: 'v4.2-intrinsic', baseNarrative: { baseRecommendationProse: 'test' } })]);
        
        // Legacy dependencies
        await tx.execute(`INSERT OR IGNORE INTO opportunities (id, company_id, canonical_title, fingerprint, lifecycle) VALUES (?, 'comp1', 'Title', ?, 'ACTIVE')`, [jobHash, jobHash]);

        // Integrity Validator reads from candidate_evaluations
        await tx.execute(`INSERT OR IGNORE INTO candidate_evaluations (person_id, job_hash, policy_version, evaluation_input_hash, engine_verdict, engine_quality_score, effective_decision, quality_score, evaluation_json, updated_at)
       VALUES (?, ?, 'v4.1', 'hash_test', ?, 90, ?, 90, '{}', CURRENT_TIMESTAMP)`,
      [personId, jobHash, verdict, verdict]);
    }
  });
}
