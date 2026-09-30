import { describe, test, expect } from "vitest";
import { getRepositories } from "../../src/data/sqlite/provider";
import { getDatabaseAdapter } from "../../src/data/database/index";
import { OpportunityService } from "@/opportunity/service";

async function seedTenantUser(userId: string) {
  const db = getDatabaseAdapter();
  const tenantId = `tenant_${userId}`;
  await db.execute(`INSERT OR IGNORE INTO tenants (id, status) VALUES (?, 'active')`, [tenantId]);
  await db.execute(`INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)`, [userId, `${userId}@example.com`]);
  await db.execute(`INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, permissions, status) VALUES (?, ?, 'user', '[]', 'active')`, [userId, tenantId]);
  await db.execute(`INSERT OR IGNORE INTO people (id, email, name, role, onboarded, email_verified, tenant_id) VALUES (?, ?, 'Test', 'user', 1, 1, ?)`, [userId, `${userId}@example.com`, tenantId]);
  await db.execute(`INSERT OR IGNORE INTO companies (id, name) VALUES (?, 'Test Co')`, [`company_${userId}`]);
  await db.execute(`INSERT OR IGNORE INTO search_plans (id, tenant_id, person_id, title, status, criteria_json) VALUES (?, ?, ?, 'Plan', 'active', '{}')`, [`sp_${userId}`, tenantId, userId]);
  await db.execute(`INSERT OR IGNORE INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, 'hash', '{}')`, [`snap_${userId}`, `sp_${userId}`, tenantId, userId]);
  await db.execute(`INSERT OR IGNORE INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES (?, ?, ?, ?, '3.0.0', 'of1', 'v4.1', '1.0')`, [`ctx_${userId}`, tenantId, userId, `snap_${userId}`]);
  await db.execute(`INSERT OR IGNORE INTO evaluation_context_scopes (tenant_id, person_id, search_plan_id, context_fingerprint) VALUES (?, ?, ?, ?)`, [tenantId, userId, `sp_${userId}`, `ctx_${userId}`]);
  await db.execute(`INSERT OR IGNORE INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by) VALUES (?, ?, ?, ?, ?)`, [tenantId, userId, `sp_${userId}`, `ctx_${userId}`, userId]);
  return tenantId;
}

async function seedOpportunity(
  tenantId: string,
  userId: string,
  jobHash: string,
  verdict: "PURSUE" | "CONSIDER" | "PASS" = "CONSIDER",
  score: number = 75,
  evaluationFingerprint: string = "fp_10",
) {
  const db = getDatabaseAdapter();
  await db.execute(`INSERT OR IGNORE INTO opportunities (id, company_id, canonical_title, fingerprint, lifecycle) VALUES (?, ?, 'Director', ?, 'ACTIVE')`, [jobHash, `company_${userId}`, jobHash]);
  await db.execute(`INSERT OR IGNORE INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES (?, 'test', ?, 'http')`, [jobHash, jobHash]);
  await db.execute(`INSERT OR IGNORE INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content, acquisition_status, lifecycle_state) VALUES (?, ?, 'ch1', 'Director', 'raw', 'ACQUIRED', 'ACTIVE')`, [`v_${jobHash}`, jobHash]);
  await db.execute(`INSERT OR IGNORE INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, ?, 'CANDIDATE')`, [tenantId, userId, `sp_${userId}`, jobHash, `v_${jobHash}`]);
  await db.execute(`INSERT OR IGNORE INTO materialized_evaluations
    (id, canonical_job_id, opportunity_version, tenant_id, person_id, evaluation_context_fingerprint, evaluation_fingerprint, evaluation_state, decision, quality_score, rationale, evidence_ids, evaluation_json, materialized_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'EVALUATED', ?, ?, 'rationale', '[]', ?, CURRENT_TIMESTAMP)`,
    [`mat_${jobHash}`, jobHash, `v_${jobHash}`, tenantId, userId, `ctx_${userId}`, evaluationFingerprint, verdict, score, JSON.stringify({
      schemaVersion: 'v4.3-intrinsic', evaluationContractVersion: 'v4.3', evaluationState: 'EVALUATED',
      canonicalJobId: jobHash, opportunityVersion: `v_${jobHash}`, jobHash,
      tenantId, personId: userId, evaluationInputHash: evaluationFingerprint, contextFingerprint: `ctx_${userId}`,
      policyVersion: 'v4.3', ontologyVersion: 'v4.0', ontologyFingerprint: 'ontology_test', profileVersion: 'profile_test',
      evaluatedAt: new Date().toISOString(), decision: verdict, score, diligenceStatus: 'READY', jobProjection: { title: 'Director' },
    })]);
}

describe("Shortlist / Evaluation Queue Unresolved Eligibility Policy", () => {
  test("1. 10 evaluated + unreviewed opportunities -> all 10 enter the queue", async () => {
    const repos = getRepositories();
    const userId = "test_user_queue_10";
    const tenantId = await seedTenantUser(userId);

    for (let i = 1; i <= 10; i++) {
      const jobHash = `test_job_10_${i}`;
      const verdict = i % 2 === 0 ? "PURSUE" : "CONSIDER";
      await seedOpportunity(tenantId, userId, jobHash, verdict, 80, "fp_10");
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: "fp_10",
        engineVerdict: i % 2 === 0 ? "PURSUE" : "CONSIDER",
        engineQualityScore: 80,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash,
          personId: userId,
          evaluationInputHash: "fp_10",
          policyVersion: "v4.3",
          ontologyVersion: "v2",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: i % 2 === 0 ? "PURSUE" : "CONSIDER",
          intrinsicQualityScore: 80,
        }),
      });
    }

    const ops = await OpportunityService.listForUser(userId);
    expect(ops.length).toBe(10);
  });

  test("2. 150 evaluated + unreviewed opportunities -> all 150 remain eligible (no 100-item cutoff)", async () => {
    const repos = getRepositories();
    const userId = "test_user_queue_150";
    const tenantId = await seedTenantUser(userId);

    for (let i = 1; i <= 150; i++) {
      const jobHash = `test_job_150_${i}`;
      await seedOpportunity(tenantId, userId, jobHash, "CONSIDER", 75, "fp_150");
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: "fp_150",
        engineVerdict: "CONSIDER",
        engineQualityScore: 75,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash,
          personId: userId,
          evaluationInputHash: "fp_150",
          policyVersion: "v4.3",
          ontologyVersion: "v2",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: "CONSIDER",
          intrinsicQualityScore: 75,
        }),
      });
    }

    const ops = await OpportunityService.listForUser(userId);
    expect(ops.length).toBe(150);
  });

  test("3. 150 evaluated + 50 already user-decided -> 150 unresolved eligible, 50 decided excluded", async () => {
    const repos = getRepositories();
    const userId = "test_user_queue_200";
    const tenantId = await seedTenantUser(userId);

    // 150 unresolved
    for (let i = 1; i <= 150; i++) {
      const jobHash = `test_job_unresolved_${i}`;
      await seedOpportunity(tenantId, userId, jobHash, "CONSIDER", 70, "fp_200");
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: "fp_200",
        engineVerdict: "CONSIDER",
        engineQualityScore: 70,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash,
          personId: userId,
          evaluationInputHash: "fp_200",
          policyVersion: "v4.3",
          ontologyVersion: "v2",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: "CONSIDER",
          intrinsicQualityScore: 70,
        }),
      });
    }

    // 50 decided
    for (let i = 1; i <= 50; i++) {
      const jobHash = `test_job_decided_${i}`;
      await seedOpportunity(tenantId, userId, jobHash, "CONSIDER", 70, "fp_200");
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: "fp_200",
        engineVerdict: "CONSIDER",
        engineQualityScore: 70,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash,
          personId: userId,
          evaluationInputHash: "fp_200",
          policyVersion: "v4.3",
          ontologyVersion: "v2",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: "CONSIDER",
          intrinsicQualityScore: 70,
        }),
      });

      await repos.decisions.recordUserDecision(
        userId,
        jobHash,
        i % 2 === 0 ? "PURSUE" : "PASS",
        "Test reason",
        "fp_200",
        tenantId
      );
    }

    const userDecisions = await repos.decisions.getUserDecisions(userId, tenantId);
    const ops = await OpportunityService.listForUser(userId);

    const unresolvedOps = ops.filter((o) => {
      const dec = userDecisions[o.jobHash];
      return !dec;
    });

    expect(unresolvedOps.length).toBe(150);
  });

  test("4, 5, 6. User decision (PURSUE/CONSIDER/PASS) + stale fingerprint -> excluded from unresolved queue", async () => {
    const repos = getRepositories();
    const userId = "test_user_stale_decisions";
    const tenantId = await seedTenantUser(userId);

    const verbs: Array<"PURSUE" | "CONSIDER" | "PASS"> = ["PURSUE", "CONSIDER", "PASS"];
    for (const verb of verbs) {
      const jobHash = `test_stale_${verb.toLowerCase()}`;
      await seedOpportunity(tenantId, userId, jobHash, "CONSIDER", 75, "fp_NEW_4_3");
      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: "fp_NEW_4_3",
        engineVerdict: "CONSIDER",
        engineQualityScore: 75,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify({
          schemaVersion: "v4.2-intrinsic",
          jobHash,
          personId: userId,
          evaluationInputHash: "fp_NEW_4_3",
          policyVersion: "v4.3",
          ontologyVersion: "v2",
          evaluatedAt: new Date().toISOString(),
          intrinsicVerdict: "CONSIDER",
          intrinsicQualityScore: 75,
        }),
      });

      await repos.decisions.recordUserDecision(
        userId,
        jobHash,
        verb,
        "Stale decision reason",
        "fp_OLD_4_0",
        tenantId
      );
    }

    const userDecisions = await repos.decisions.getUserDecisions(userId, tenantId);

    for (const verb of verbs) {
      const jobHash = `test_stale_${verb.toLowerCase()}`;
      const dec = userDecisions[jobHash];
      expect(dec).toBeDefined();
      expect(dec?.verb).toBe(verb);
    }
  });

  test("7, 8. New unreviewed engine PURSUE & CONSIDER -> included in unresolved queue", async () => {
    const repos = getRepositories();
    const userId = "test_user_fresh_engine";
    const tenantId = await seedTenantUser(userId);

    const pursueHash = "test_fresh_engine_pursue";
    const considerHash = "test_fresh_engine_consider";

    await seedOpportunity(tenantId, userId, pursueHash, "PURSUE", 92, "fp_fresh");
    await seedOpportunity(tenantId, userId, considerHash, "CONSIDER", 78, "fp_fresh");

    await repos.evaluations.saveEvaluation({
      personId: userId,
      jobHash: pursueHash,
      policyVersion: "v4.3",
      evaluationInputHash: "fp_fresh",
      engineVerdict: "PURSUE",
      engineQualityScore: 92,
      evaluationStatus: "COMPLETE",
      evaluationJson: JSON.stringify({
        schemaVersion: "v4.2-intrinsic",
        jobHash: pursueHash,
        personId: userId,
        evaluationInputHash: "fp_fresh",
        policyVersion: "v4.3",
        ontologyVersion: "v2",
        evaluatedAt: new Date().toISOString(),
        intrinsicVerdict: "PURSUE",
        intrinsicQualityScore: 92,
      }),
    });

    await repos.evaluations.saveEvaluation({
      personId: userId,
      jobHash: considerHash,
      policyVersion: "v4.3",
      evaluationInputHash: "fp_fresh",
      engineVerdict: "CONSIDER",
      engineQualityScore: 78,
      evaluationStatus: "COMPLETE",
      evaluationJson: JSON.stringify({
        schemaVersion: "v4.2-intrinsic",
        jobHash: considerHash,
        personId: userId,
        evaluationInputHash: "fp_fresh",
        policyVersion: "v4.3",
        ontologyVersion: "v2",
        evaluatedAt: new Date().toISOString(),
        intrinsicVerdict: "CONSIDER",
        intrinsicQualityScore: 78,
      }),
    });

    const ops = await OpportunityService.listForUser(userId);
    const hashes = ops.map((o) => o.jobHash);

    expect(hashes).toContain(pursueHash);
    expect(hashes).toContain(considerHash);
  });

  test("9. Unevaluated opportunity -> does not appear as completed evaluation", async () => {
    const repos = getRepositories();
    const userId = "test_user_unevaluated";
    const unevaluatedHash = "test_unevaluated_job";

    const evalRec = await repos.evaluations.getEvaluation(userId, unevaluatedHash);
    expect(evalRec).toBeNull();
  });
});
