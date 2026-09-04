import { describe, test, expect, beforeAll } from "vitest";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";
import { serveEvaluation, adaptLegacyEvaluation } from "../../src/lib/intelligence/serving/EvaluationServingEngine";
import type { CanonicalIntrinsicEvaluationPayload } from "../../src/lib/intelligence/serving/EvaluationServingEngine";
import { getRepositories } from "../../src/data/sqlite/provider";
import { getDatabaseAdapter } from "../../src/data/database";

describe("Headspace Serving Contract Regression Suite", () => {
  const userId = "ms6i7e3y-4x0chy5fy";
  const tenantId = `tenant_${userId}`;

  beforeAll(async () => {
    const repos = getRepositories();
    const db = getDatabaseAdapter();

    await db.execute(`INSERT OR IGNORE INTO tenants (id, status) VALUES (?, 'active')`, [tenantId]);
    await db.execute(`INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)`, [userId, `${userId}@example.com`]);
    await db.execute(`INSERT OR IGNORE INTO people (id, email, name, role, onboarded, email_verified, tenant_id) VALUES (?, ?, 'Test', 'user', 1, 1, ?)`, [userId, `${userId}@example.com`, tenantId]);
    await db.execute(`INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, permissions, status) VALUES (?, ?, 'owner', '["read:opportunity","write:opportunity"]', 'active')`, [userId, tenantId]);
    await db.execute(`INSERT OR IGNORE INTO search_plans (id, tenant_id, person_id, title, status, criteria_json) VALUES (?, ?, ?, 'Plan', 'active', '{}')`, [`sp_${userId}`, tenantId, userId]);
    await db.execute(`INSERT OR IGNORE INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json) VALUES (?, ?, ?, ?, 'hash', '{}')`, [`snap_${userId}`, `sp_${userId}`, tenantId, userId]);
    await db.execute(`INSERT OR IGNORE INTO evaluation_contexts (context_fingerprint, tenant_id, person_id, search_plan_snapshot_id, ontology_version, ontology_fingerprint, policy_version, profile_version) VALUES (?, ?, ?, ?, '3.0.0', 'of1', 'v4.1', '1.0')`, [`ctx_${userId}`, tenantId, userId, `snap_${userId}`]);
    await db.execute(`INSERT OR IGNORE INTO evaluation_context_scopes (tenant_id, person_id, search_plan_id, context_fingerprint) VALUES (?, ?, ?, ?)`, [tenantId, userId, `sp_${userId}`, `ctx_${userId}`]);
    await db.execute(`INSERT OR IGNORE INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by) VALUES (?, ?, ?, ?, ?)`, [tenantId, userId, `sp_${userId}`, `ctx_${userId}`, userId]);

    // 1. Seed candidate projection with attention window 5
    const { CandidateProjectionBuilderImpl } = await import("../../src/lib/intelligence/builders/CandidateProjectionBuilder");
    const { candidateProfile } = await import("../../src/data/candidate-profile");
    const baseProj = new CandidateProjectionBuilderImpl().fromProfile(candidateProfile);
    await repos.people.saveProjection(userId, {
      ...baseProj,
      attentionWindow: 5,
    });
    await db.execute(`INSERT OR IGNORE INTO companies (id, name) VALUES (?, 'Headspace Fixture Co')`, [`company_${userId}`]);

    // 2. Seed 6 active pursuits to saturate headspace (activePursuits = 6 >= attentionWindow = 6)
    for (let i = 1; i <= 6; i++) {
      const activeJob = `j-active-${i}`;
      await db.execute(`INSERT OR IGNORE INTO opportunities (id, company_id, canonical_title, fingerprint, lifecycle) VALUES (?, ?, 'Director', ?, 'ACTIVE')`, [activeJob, `company_${userId}`, activeJob]);
      await db.execute(`INSERT OR IGNORE INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES (?, 'test', ?, 'http')`, [activeJob, activeJob]);
      await db.execute(`INSERT OR IGNORE INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content, acquisition_status, lifecycle_state) VALUES (?, ?, 'ch1', 'Dir', 'raw', 'ACQUIRED', 'ACTIVE')`, [`v_${activeJob}`, activeJob]);
      await db.execute(`INSERT OR IGNORE INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, ?, 'CANDIDATE')`, [tenantId, userId, `sp_${userId}`, activeJob, `v_${activeJob}`]);
      await db.execute(`INSERT OR IGNORE INTO materialized_evaluations 
        (id, canonical_job_id, opportunity_version, tenant_id, person_id, evaluation_context_fingerprint, evaluation_state, decision, quality_score, rationale, evidence_ids, evaluation_json, materialized_at) 
        VALUES (?, ?, ?, ?, ?, ?, 'EVALUATED', 'PURSUE', 80, 'rationale', '[]', ?, CURRENT_TIMESTAMP)`, 
        [`mat_${activeJob}`, activeJob, `v_${activeJob}`, tenantId, userId, `ctx_${userId}`, JSON.stringify({ schemaVersion: 'v4.2-intrinsic', jobHash: activeJob, intrinsicVerdict: 'PURSUE', intrinsicQualityScore: 80, baseNarrative: { baseRecommendationProse: 'test' } })]);
      await repos.decisions.recordUserDecision(userId, activeJob, "PURSUE", undefined, null, tenantId);
    }

    // 3. Seed the two evaluated opportunities
    const jobs = [
      { jobHash: "j-099437e80b44", score: 79 },
      { jobHash: "j-9d2006e16aba", score: 76 },
    ];

    for (const job of jobs) {
      await db.execute(`INSERT OR IGNORE INTO opportunities (id, company_id, canonical_title, fingerprint, lifecycle) VALUES (?, ?, 'VP Growth', ?, 'ACTIVE')`, [job.jobHash, `company_${userId}`, job.jobHash]);
      await db.execute(`INSERT OR IGNORE INTO canonical_opportunities (id, source, source_job_id, canonical_url) VALUES (?, 'test', ?, 'http')`, [job.jobHash, job.jobHash]);
      await db.execute(`INSERT OR IGNORE INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content, acquisition_status, lifecycle_state) VALUES (?, ?, 'ch1', 'Dir', 'raw', 'ACQUIRED', 'ACTIVE')`, [`v_${job.jobHash}`, job.jobHash]);
      await db.execute(`INSERT OR IGNORE INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision) VALUES (?, ?, ?, ?, ?, 'CANDIDATE')`, [tenantId, userId, `sp_${userId}`, job.jobHash, `v_${job.jobHash}`]);

      const evalPayload = {
        schemaVersion: "v4.2-intrinsic",
        jobHash: job.jobHash,
        personId: userId,
        evaluationInputHash: `fp_${job.jobHash}`,
        policyVersion: "v4.3",
        ontologyVersion: "v4.0",
        evaluatedAt: new Date().toISOString(),
        intrinsicVerdict: "PURSUE",
        intrinsicQualityScore: job.score,
        parsingConfidence: 0.95,
        vetoed: false,
        vetoReason: null,
        triggeredRuleIds: ["R-PURSUE"],
        decisionRisks: [],
        decisionDrivers: [],
        evaluationStatus: "COMPLETE",
        dimensions: [],
        esi: 80,
        diligenceStatus: "VERIFIED",
        baseNarrative: {
          baseRecommendationProse: "Exceptional mandate match.",
        },
        auditTrace: {
          verb0: "PURSUE",
          careerValue: 80,
          shortlistingPotential: 80,
          pursuitFriction: 20,
          rawScore: job.score,
          evidenceMappingCount: 5,
        },
      };

      await db.execute(`INSERT OR IGNORE INTO materialized_evaluations 
        (id, canonical_job_id, opportunity_version, tenant_id, person_id, evaluation_context_fingerprint, evaluation_state, decision, quality_score, rationale, evidence_ids, evaluation_json, materialized_at) 
        VALUES (?, ?, ?, ?, ?, ?, 'EVALUATED', 'PURSUE', ?, 'Exceptional mandate match.', '[]', ?, CURRENT_TIMESTAMP)`, 
        [`mat_${job.jobHash}`, job.jobHash, `v_${job.jobHash}`, tenantId, userId, `ctx_${userId}`, job.score, JSON.stringify(evalPayload)]);

      await repos.evaluations.saveEvaluation({
        personId: userId,
        jobHash: job.jobHash,
        policyVersion: "v4.3",
        evaluationInputHash: `fp_${job.jobHash}`,
        engineVerdict: "PURSUE",
        engineQualityScore: job.score,
        evaluationStatus: "COMPLETE",
        evaluationJson: JSON.stringify(evalPayload),
      });
    }
  });

  test("A. headspace does not downgrade a persisted PURSUE verdict", async () => {
    const opp = await OpportunityService.getForUser(userId, "j-099437e80b44");

    expect(opp).toBeDefined();
    expect(opp!.engineRecommendation).toBeDefined();

    // 1. Intrinsic score and verdict must be preserved
    expect(opp!.engineRecommendation?.qualityScore).toBe(79);
    expect(opp!.engineRecommendation?.engineVerdict).toBe("PURSUE");
    expect(opp!.engineRecommendation?.verb0).toBe("PURSUE");
    expect(opp!.decision).toBe("PURSUE");
    expect(opp!.effectiveDecision).toBe("PURSUE");
    expect(opp!.engineRecommendation?.headspaceVerdict).toBeUndefined();
    expect(opp!.engineRecommendation?.headspaceDowngraded).toBeUndefined();

    // 3. Presentation badge must reflect intrinsic PURSUE
    expect(opp!.uiBadge.label).toBe("Recommended");
    expect(opp!.uiBadge.variant).toBe("signal");
  });

  test("B. pagination capacity does not alter a second PURSUE verdict", async () => {
    const opp = await OpportunityService.getForUser(userId, "j-9d2006e16aba");

    expect(opp).toBeDefined();
    expect(opp!.engineRecommendation).toBeDefined();

    // 1. Intrinsic score and verdict must be preserved
    expect(opp!.engineRecommendation?.qualityScore).toBe(76);
    expect(opp!.engineRecommendation?.engineVerdict).toBe("PURSUE");
    expect(opp!.engineRecommendation?.verb0).toBe("PURSUE");
    expect(opp!.decision).toBe("PURSUE");
    expect(opp!.effectiveDecision).toBe("PURSUE");
    expect(opp!.engineRecommendation?.headspaceVerdict).toBeUndefined();
    expect(opp!.engineRecommendation?.headspaceDowngraded).toBeUndefined();

    // 3. Presentation badge must reflect intrinsic PURSUE
    expect(opp!.uiBadge.label).toBe("Recommended");
    expect(opp!.uiBadge.variant).toBe("signal");
  });

  test("C. Genuine intrinsic CONSIDER opportunity remains CONSIDER regardless of Headspace", () => {
    const cachedConsider: CanonicalIntrinsicEvaluationPayload = {
      schemaVersion: "v4.2-intrinsic",
      jobHash: "test-consider-job",
      personId: userId,
      evaluationInputHash: "hash-consider",
      policyVersion: "v4.3",
      ontologyVersion: "v4.0",
      evaluatedAt: new Date().toISOString(),
      intrinsicVerdict: "CONSIDER",
      intrinsicQualityScore: 62,
      parsingConfidence: 0.85,
      vetoed: false,
      vetoReason: null,
      triggeredRuleIds: ["R-CONSIDER"],
      decisionRisks: [],
      decisionDrivers: [],
      evaluationStatus: "COMPLETE",
      dimensions: [],
      esi: 65,
      diligenceStatus: "COMPLETE",
      baseNarrative: {
        baseRecommendationProse: "Verify team scale before advancing.",
      },
      auditTrace: {
        verb0: "CONSIDER",
        careerValue: 60,
        shortlistingPotential: 62,
        pursuitFriction: 20,
        rawScore: 62,
        evidenceMappingCount: 5,
      },
    };

    // Saturated headspace
    const servedSaturated = serveEvaluation(
      cachedConsider,
      { personId: userId, attentionWindow: 5, activePursuits: 10 },
      { jobHash: "test-consider-job", role: "VP Engineering", company: "Acme Corp" },
      null
    );

    expect(servedSaturated.engineRecommendation?.engineVerdict).toBe("CONSIDER");
    expect(servedSaturated.engineRecommendation?.verb0).toBe("CONSIDER");
    expect(servedSaturated.engineRecommendation?.headspaceVerdict).toBeUndefined();
    expect(servedSaturated.engineRecommendation?.headspaceDowngraded).toBeUndefined();
    expect(servedSaturated.uiBadge.label).toBe("Consider");
    expect(servedSaturated.uiBadge.variant).toBe("caution");
  });

  test("D. Intrinsic PURSUE opportunity with non-saturated Headspace serves PURSUE without downgrade", () => {
    const cachedPursue: CanonicalIntrinsicEvaluationPayload = {
      schemaVersion: "v4.2-intrinsic",
      jobHash: "test-pursue-job",
      personId: userId,
      evaluationInputHash: "hash-pursue",
      policyVersion: "v4.3",
      ontologyVersion: "v4.0",
      evaluatedAt: new Date().toISOString(),
      intrinsicVerdict: "PURSUE",
      intrinsicQualityScore: 88,
      parsingConfidence: 0.9,
      vetoed: false,
      vetoReason: null,
      triggeredRuleIds: ["R-PURSUE-HIGH"],
      decisionRisks: [],
      decisionDrivers: [],
      evaluationStatus: "COMPLETE",
      dimensions: [],
      esi: 85,
      diligenceStatus: "COMPLETE",
      baseNarrative: {
        baseRecommendationProse: "Exceptional mandate fit.",
      },
      auditTrace: {
        verb0: "PURSUE",
        careerValue: 88,
        shortlistingPotential: 90,
        pursuitFriction: 10,
        rawScore: 88,
        evidenceMappingCount: 8,
      },
    };

    // Non-saturated headspace (2 active / 5 capacity)
    const servedUnsaturated = serveEvaluation(
      cachedPursue,
      { personId: userId, attentionWindow: 5, activePursuits: 2 },
      { jobHash: "test-pursue-job", role: "Chief Commercial Officer", company: "GrowthCo" },
      null
    );

    expect(servedUnsaturated.engineRecommendation?.engineVerdict).toBe("PURSUE");
    expect(servedUnsaturated.engineRecommendation?.verb0).toBe("PURSUE");
    expect(servedUnsaturated.engineRecommendation?.headspaceVerdict).toBeUndefined();
    expect(servedUnsaturated.engineRecommendation?.headspaceDowngraded).toBeUndefined();
    expect(servedUnsaturated.uiBadge.label).toBe("Recommended");
    expect(servedUnsaturated.uiBadge.variant).toBe("signal");
  });

  test("E. adaptLegacyEvaluation follows the exact same contract", () => {
    const legacyOpp = {
      jobHash: "legacy-job-01",
      decision: "PURSUE",
      recommendationResult: { score: 80 },
      engineRecommendation: {
        engineVerdict: "PURSUE",
        qualityScore: 80,
      },
      recommendation: "Strong candidate match.",
    };

    const adapted = adaptLegacyEvaluation(
      legacyOpp,
      { personId: userId, attentionWindow: 5, activePursuits: 20 }, // Saturated
      { jobHash: "legacy-job-01", role: "Managing Director", company: "Legacy Capital" },
      null
    );

    expect(adapted.engineRecommendation?.engineVerdict).toBe("PURSUE");
    expect(adapted.engineRecommendation?.verb0).toBe("PURSUE");
    expect(adapted.engineRecommendation?.headspaceVerdict).toBeUndefined();
    expect(adapted.engineRecommendation?.headspaceDowngraded).toBeUndefined();
    expect(adapted.engineRecommendation?.headspaceReason).toBeUndefined();
  });

  test("F. Invariance Verification: DB records and queue eligibility are unchanged", async () => {
    const repos = getRepositories();

    // 1. Verify candidate_evaluations table in Turso Cloud DB directly
    const dbEval1 = await repos.evaluations.getEvaluation(userId, "j-099437e80b44");
    expect(dbEval1).toBeDefined();
    expect(dbEval1?.engineVerdict).toBe("PURSUE");

    // 2. Verify total evaluated and unresolved count
    const list = await OpportunityService.listForUser(userId);
    const totalEvaluated = await repos.evaluations.listEvaluationsForUser(userId);
    const userDecisionsDB = await repos.decisions.getUserDecisions(userId, tenantId);

    const userDecidedJobHashes = new Set(
      Object.values(userDecisionsDB)
        .filter((d) => d.verb === "PURSUE" || d.verb === "CONSIDER" || d.verb === "PASS")
        .map((d) => d.jobHash)
    );

    const expectedUnresolvedCount = totalEvaluated.filter((e) => !userDecidedJobHashes.has(e.jobHash)).length;

    const unresolvedList = list.filter((o) => !o.userDecision || o.userDecision.userAction === "NONE");

    // Unresolved list count should equal unresolved evaluated population
    expect(unresolvedList.length).toBe(expectedUnresolvedCount);
  });
});
