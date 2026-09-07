import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";
import { EvaluationWorker } from "@/lib/intelligence/EvaluationWorker";
import { SqliteOpportunityQueries } from "@/data/sqlite/repositories/SqliteOpportunityQueries";
import { resolveServingScope } from "@/lib/security/scope-resolver";
import { computeEvaluationContextFingerprint } from "@/lib/domain/evaluation_fingerprint";
import { computeCanonicalJobId } from "@/lib/domain/canonical_identity";
import type { CandidateProfile } from "@/data/candidate-profile";
import type { CandidateProjection } from "@/lib/domain/candidate_projection";

class TestSqliteAdapter implements DatabaseAdapter {
  constructor(public db: Database.Database) {}
  async one<T>(sql: string, params?: QueryParams): Promise<T | null> {
    const stmt = this.db.prepare(sql);
    const row = stmt.get(...(params || []));
    return (row as T) || null;
  }
  async many<T>(sql: string, params?: QueryParams): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    return stmt.all(...(params || [])) as T[];
  }
  async execute(sql: string, params?: QueryParams): Promise<{
    rowsAffected: number;
    lastInsertRowid?: number | bigint | string;
  }> {
    const stmt = this.db.prepare(sql);
    const info = stmt.run(...(params || []));
    return { rowsAffected: info.changes, lastInsertRowid: info.lastInsertRowid };
  }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const res = await fn(this);
      this.db.exec("COMMIT");
      return res;
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }
}

import { runMigrations } from "@/data/sqlite/migrations/runner";

describe("M9.4.1 Forensic Certification: Evaluation Determinism & Snapshot Lineage Contract", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;

  const TENANT_ID = "tenant_det_1";
  const PERSON_ID = "person_det_1";
  const PLAN_ID = "plan_det_1";

  const profileSnapshot: CandidateProfile = {
    identity: {
      fullName: "Test Executive Candidate",
      currentTitle: "VP Marketing",
      currentCompany: "Enterprise Scale Co",
      location: "Bengaluru",
      targetRoles: ["VP Marketing", "Chief Marketing Officer"]
    },
    executiveIdentity: {
      archetype: "Growth Executive",
      valueProposition: "Scaling B2B Enterprise SaaS ARR from $10M to $100M",
      executiveThemes: ["Strategic Marketing", "Growth Scaling", "Global Enterprise"]
    },
    experience: {
      totalYears: 18,
      leadershipYears: 10,
      achievements: [
        "Scaled revenue 4x in 3 years",
        "Built and led 45-person global marketing team",
        "Managed $15M annual marketing budget"
      ]
    },
    evidence: [],
    preferences: {
      targetLocations: ["Bengaluru", "Remote"],
      minCompINR: 8000000,
      targetCompanyStages: ["Series B", "Series C", "Public"]
    }
  };

  const authoritativeProjection: CandidateProjection = {
    attainedTitle: "VP Marketing",
    profileVersion: "p_v1",
    operatingLevel: { value: "STRATEGIC", confidence: 0.95, evidenceIds: ["candidate-operating-level"] },
    workNature: { value: "STRATEGIC_WORK", confidence: 0.95, evidenceIds: ["candidate-work-nature"] },
    decisionAuthority: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["candidate-decision-authority"] },
    commercialScope: { value: "ENTERPRISE", confidence: 0.95, evidenceIds: ["candidate-commercial-scope"] },
    yearsOfExperience: 18,
    coreCapabilities: ["COMMERCIAL_GROWTH", "GLOBAL_GTM", "MARKETING_LEADERSHIP"],
    preferredLocations: ["Bengaluru", "Remote"],
    preferredWorkModel: "HYBRID",
    executiveThemes: ["commercial_growth", "gtm_scale"],
    attentionWindow: 6,
    headspaceCapacityPerMonth: 4,
  };

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");
    adapter = new TestSqliteAdapter(sqliteDb);
    await runMigrations(adapter);

    // Setup tenant, person, and search plan
    sqliteDb.prepare(`INSERT INTO tenants (id, status, created_at, updated_at) VALUES (?, 'active', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(TENANT_ID);
    sqliteDb.prepare(`INSERT INTO people (id, tenant_id, email, created_at, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(
      PERSON_ID, TENANT_ID, "candidate@example.com"
    );
    sqliteDb.prepare(`INSERT INTO users (id, email) VALUES (?, ?)`).run(PERSON_ID, "candidate@example.com");
    sqliteDb.prepare(`INSERT INTO memberships (user_id, tenant_id, role, permissions, status) VALUES (?, ?, 'admin', '[\"*\"]', 'active')`).run(PERSON_ID, TENANT_ID);
    sqliteDb.prepare(`
      INSERT INTO career_profiles (
        id, person_id, timeline, skills, projection_json, projection_generated_at,
        current_title, years_experience, archetype, preferred_work_model, created_at, updated_at
      ) VALUES (?, ?, '[]', '[]', ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(
      `profile-${PERSON_ID}`,
      PERSON_ID,
      JSON.stringify(authoritativeProjection),
      authoritativeProjection.attainedTitle,
      authoritativeProjection.yearsOfExperience,
      "Growth Executive",
      authoritativeProjection.preferredWorkModel,
    );
    sqliteDb.prepare(`INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(
      PLAN_ID, TENANT_ID, PERSON_ID, "Executive Search Plan"
    );
  });

  test("Snapshot payload ensures identical evaluation results across repeated runs", async () => {
    const canonicalJobId = computeCanonicalJobId({ source: "LinkedIn", sourceJobId: "det-job-001" });
    const oppVersion = "ver_det_001";

    sqliteDb.prepare(`
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(canonicalJobId, "LinkedIn", "det-job-001", "https://linkedin.com/jobs/001", "Scale Corp");

    const rawContentJson = JSON.stringify({
      jobHash: canonicalJobId,
      role: "VP of Growth & Marketing",
      company: "Scale Corp",
      location: "Bengaluru",
      rawDescription: "Looking for an experienced VP of Growth and Marketing to lead enterprise GTM, commercial expansion, global demand generation, and a 45-person team. The role owns strategic growth planning, executive stakeholder alignment, and measurable revenue outcomes."
    });

    sqliteDb.prepare(`
      INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, company_name, location, employment_type, raw_content, acquisition_status, lifecycle_state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACQUIRED', 'ACTIVE', CURRENT_TIMESTAMP)
    `).run(oppVersion, canonicalJobId, "hash_001", "VP of Growth & Marketing", "Scale Corp", "Bengaluru", "Full-time", rawContentJson);

    sqliteDb.prepare(`
      INSERT INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision)
      VALUES (?, ?, ?, ?, ?, 'CANDIDATE')
    `).run(PLAN_ID, TENANT_ID, PERSON_ID, canonicalJobId, oppVersion);

    const snapshotId = "snap_det_001";
    sqliteDb.prepare(`
      INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(snapshotId, PLAN_ID, TENANT_ID, PERSON_ID, "snap_hash_001", JSON.stringify(profileSnapshot));

    const fingerprint = computeEvaluationContextFingerprint({
      tenantId: TENANT_ID,
      personId: PERSON_ID,
      searchPlanSnapshotId: snapshotId,
      ontologyVersion: "3.0.0",
      ontologyFingerprint: "onto_hash_001",
      policyVersion: "v4.1",
      profileVersion: "p_v1"
    });

    sqliteDb.prepare(`
      INSERT INTO evaluation_contexts (
        context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
        ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(fingerprint, TENANT_ID, PERSON_ID, snapshotId, "3.0.0", "onto_hash_001", "v4.1", "p_v1");
    sqliteDb.prepare(`
      INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id)
      VALUES (?, ?, ?, ?)
    `).run(fingerprint, TENANT_ID, PERSON_ID, PLAN_ID);
    sqliteDb.prepare(`
      INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(TENANT_ID, PERSON_ID, PLAN_ID, fingerprint, PERSON_ID);

    const jobId = "job_det_001";
    sqliteDb.prepare(`
      INSERT INTO evaluation_jobs (
        id, tenant_id, person_id, search_plan_id, canonical_job_id,
        opportunity_version, evaluation_context_fingerprint,
        status, attempts, max_attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(jobId, TENANT_ID, PERSON_ID, PLAN_ID, canonicalJobId, oppVersion, fingerprint);

    const worker = new EvaluationWorker("worker_det_test", { adapter });

    // Claim and process job 1
    const claim1 = await worker.claimNextJob();
    expect(claim1).not.toBeNull();
    const result1 = await worker.processJob(claim1!);
    expect(result1.status).toBe("completed");

    const eval1 = sqliteDb.prepare(`SELECT * FROM materialized_evaluations WHERE canonical_job_id = ?`).get(canonicalJobId) as any;
    expect(eval1).toBeDefined();
    expect(eval1.decision).toBeDefined();
    expect(eval1.quality_score).toBeGreaterThan(0);

    // Regression: the artifact emitted by the real worker must be the exact
    // artifact accepted by both canonical serving surfaces. No test-authored
    // evaluation JSON is involved in this proof.
    const payload = JSON.parse(eval1.evaluation_json);
    expect(payload.schemaVersion).toBe("v4.3-intrinsic");
    expect(eval1.evaluation_context_fingerprint).toBe(payload.contextFingerprint);
    expect(eval1.evaluation_fingerprint).toBe(payload.evaluationInputHash);
    const scope = (await resolveServingScope(PERSON_ID, TENANT_ID, adapter)).scope;
    const queries = new SqliteOpportunityQueries(adapter);
    const feed = await queries.getFeed(scope);
    expect(feed.items).toHaveLength(1);
    const feedItem = feed.items[0];
    expect(feedItem.evaluationState).toBe("EVALUATED");
    expect(feedItem.engineVerdict).toBe(payload.decision);
    expect(feedItem.qualityScore).toBe(payload.score);
    expect(feedItem.evaluationContextFingerprint).toBe(payload.contextFingerprint);
    expect(feedItem.evaluationFingerprint).toBe(payload.evaluationInputHash);
    const dossier = await queries.getDossier(scope, feedItem.jobHash);
    expect(dossier).toBeDefined();
    expect(dossier!.evaluationState).toBe("EVALUATED");
    expect(dossier!.engineRecommendation?.engineVerdict).toBe(feedItem.engineVerdict);
    expect(dossier!.engineRecommendation?.qualityScore).toBe(feedItem.qualityScore);
    expect(dossier!.evaluationContextFingerprint).toBe(feedItem.evaluationContextFingerprint);
    expect(dossier!.evaluationFingerprint).toBe(feedItem.evaluationFingerprint);

    // Re-evaluate under another search plan with the identical context snapshot to prove determinism
    const PLAN_ID_2 = "plan_det_2";
    sqliteDb.prepare(`INSERT INTO search_plans (id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'active', '{}', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(
      PLAN_ID_2, TENANT_ID, PERSON_ID, "Executive Search Plan 2"
    );

    sqliteDb.prepare(`
      INSERT INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision)
      VALUES (?, ?, ?, ?, ?, 'CANDIDATE')
    `).run(PLAN_ID_2, TENANT_ID, PERSON_ID, canonicalJobId, oppVersion);

    const snapshotId2 = "snap_det_002";
    sqliteDb.prepare(`
      INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(snapshotId2, PLAN_ID_2, TENANT_ID, PERSON_ID, "snap_hash_002", JSON.stringify(profileSnapshot));

    const fingerprint2 = computeEvaluationContextFingerprint({
      tenantId: TENANT_ID,
      personId: PERSON_ID,
      searchPlanSnapshotId: snapshotId2,
      ontologyVersion: "3.0.0",
      ontologyFingerprint: "onto_hash_001",
      policyVersion: "v4.1",
      profileVersion: "p_v1"
    });

    sqliteDb.prepare(`
      INSERT INTO evaluation_contexts (
        context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
        ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(fingerprint2, TENANT_ID, PERSON_ID, snapshotId2, "3.0.0", "onto_hash_001", "v4.1", "p_v1");

    const jobId2 = "job_det_002";
    sqliteDb.prepare(`
      INSERT INTO evaluation_jobs (
        id, tenant_id, person_id, search_plan_id, canonical_job_id,
        opportunity_version, evaluation_context_fingerprint,
        status, attempts, max_attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(jobId2, TENANT_ID, PERSON_ID, PLAN_ID_2, canonicalJobId, oppVersion, fingerprint2);

    const claim2 = await worker.claimNextJob();
    expect(claim2).not.toBeNull();
    const result2 = await worker.processJob(claim2!);
    expect(result2.status).toBe("completed");

    const eval2 = sqliteDb.prepare(`SELECT * FROM materialized_evaluations WHERE canonical_job_id = ? AND evaluation_context_fingerprint = ?`).get(canonicalJobId, fingerprint2) as any;
    
    // Distinct snapshots create distinct context and input identities. The evaluated
    // outcome and intrinsic job projection must nevertheless be reproducible.
    expect(eval2.decision).toBe(eval1.decision);
    expect(eval2.quality_score).toBe(eval1.quality_score);
    const payload1 = JSON.parse(eval1.evaluation_json);
    const payload2 = JSON.parse(eval2.evaluation_json);
    expect(payload2.contextFingerprint).not.toBe(payload1.contextFingerprint);
    expect(payload2.evaluationInputHash).not.toBe(payload1.evaluationInputHash);
    expect(payload2.decision).toBe(payload1.decision);
    expect(payload2.score).toBe(payload1.score);
    expect(payload2.jobProjection).toEqual(payload1.jobProjection);
  });

  test("Missing evaluation context throws explicit error without silent corruption", async () => {
    const canonicalJobId = computeCanonicalJobId({ source: "LinkedIn", sourceJobId: "det-job-missing" });
    const oppVersion = "ver_det_missing";

    sqliteDb.prepare(`
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(canonicalJobId, "LinkedIn", "det-job-missing", "https://linkedin.com/jobs/missing", "Missing Corp");

    sqliteDb.prepare(`
      INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, company_name, location, employment_type, raw_content, acquisition_status, lifecycle_state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACQUIRED', 'ACTIVE', CURRENT_TIMESTAMP)
    `).run(oppVersion, canonicalJobId, "hash_missing", "Director Marketing", "Missing Corp", "Remote", "Full-time", JSON.stringify({ jobHash: canonicalJobId, role: "Director Marketing" }));

    sqliteDb.prepare(`
      INSERT INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision)
      VALUES (?, ?, ?, ?, ?, 'CANDIDATE')
    `).run(PLAN_ID, TENANT_ID, PERSON_ID, canonicalJobId, oppVersion);

    // Context fingerprint with NO matching context in evaluation_contexts
    const fakeFingerprint = "non_existent_fingerprint_hash";
    const jobId = "job_det_missing";
    sqliteDb.prepare(`
      INSERT INTO evaluation_jobs (
        id, tenant_id, person_id, search_plan_id, canonical_job_id,
        opportunity_version, evaluation_context_fingerprint,
        status, attempts, max_attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(jobId, TENANT_ID, PERSON_ID, PLAN_ID, canonicalJobId, oppVersion, fakeFingerprint);

    const worker = new EvaluationWorker("worker_missing_test", { adapter });
    const claim = await worker.claimNextJob();
    expect(claim).not.toBeNull();
    const result = await worker.processJob(claim!);

    // The job should fail gracefully with retry_scheduled without creating a corrupted materialized evaluation
    expect(result.status).toBe("retry_scheduled");
    expect(result.error).toContain("Missing evaluation context");

    const jobRow = sqliteDb.prepare(`SELECT status, attempts FROM evaluation_jobs WHERE id = ?`).get(jobId) as any;
    expect(jobRow.status).toBe("pending"); // Retrying
    expect(jobRow.attempts).toBe(1);

    const materializedCount = sqliteDb.prepare(`SELECT COUNT(*) as c FROM materialized_evaluations WHERE canonical_job_id = ?`).get(canonicalJobId) as any;
    expect(materializedCount.c).toBe(0);
  });

  test("Historical evaluation remains byte-for-byte deterministic after candidate profile is mutated", async () => {
    const canonicalJobId = computeCanonicalJobId({ source: "LinkedIn", sourceJobId: "det-job-mutation-replay" });
    const oppVersion = "ver_det_replay_001";

    sqliteDb.prepare(`
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(canonicalJobId, "LinkedIn", "det-job-mutation-replay", "https://linkedin.com/jobs/replay-001", "Acme Growth Corp");

    const rawContentJson = JSON.stringify({
      jobHash: canonicalJobId,
      role: "VP Marketing & Demand Gen",
      company: "Acme Growth Corp",
      location: "Bengaluru",
      rawDescription: "Looking for an executive VP of Marketing to lead enterprise demand generation and growth."
    });

    sqliteDb.prepare(`
      INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, company_name, location, employment_type, raw_content, acquisition_status, lifecycle_state, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACQUIRED', 'ACTIVE', CURRENT_TIMESTAMP)
    `).run(oppVersion, canonicalJobId, "hash_replay_001", "VP Marketing & Demand Gen", "Acme Growth Corp", "Bengaluru", "Full-time", rawContentJson);

    sqliteDb.prepare(`
      INSERT INTO search_plan_candidates (search_plan_id, tenant_id, person_id, canonical_job_id, opportunity_version, attention_decision)
      VALUES (?, ?, ?, ?, ?, 'CANDIDATE')
    `).run(PLAN_ID, TENANT_ID, PERSON_ID, canonicalJobId, oppVersion);

    // 1. Snapshot V1 & Context Fingerprint V1
    const snapshotIdV1 = "snap_profile_v1";
    sqliteDb.prepare(`
      INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(snapshotIdV1, PLAN_ID, TENANT_ID, PERSON_ID, "snap_hash_v1", JSON.stringify(profileSnapshot));

    const fingerprintV1 = computeEvaluationContextFingerprint({
      tenantId: TENANT_ID,
      personId: PERSON_ID,
      searchPlanSnapshotId: snapshotIdV1,
      ontologyVersion: "3.0.0",
      ontologyFingerprint: "onto_hash_v1",
      policyVersion: "v4.1",
      profileVersion: "profile_v1"
    });

    sqliteDb.prepare(`
      INSERT INTO evaluation_contexts (
        context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
        ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(fingerprintV1, TENANT_ID, PERSON_ID, snapshotIdV1, "3.0.0", "onto_hash_v1", "v4.1", "profile_v1");

    const jobIdV1 = "job_replay_v1";
    sqliteDb.prepare(`
      INSERT INTO evaluation_jobs (
        id, tenant_id, person_id, search_plan_id, canonical_job_id,
        opportunity_version, evaluation_context_fingerprint,
        status, attempts, max_attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(jobIdV1, TENANT_ID, PERSON_ID, PLAN_ID, canonicalJobId, oppVersion, fingerprintV1);

    const worker = new EvaluationWorker("worker_replay_test", { adapter });
    const claim1 = await worker.claimNextJob();
    expect(claim1?.id).toBe(jobIdV1);
    const result1 = await worker.processJob(claim1!);
    expect(result1.status).toBe("completed");

    // Fetch and snapshot the historical evaluation E1
    const evalV1 = sqliteDb.prepare(`
      SELECT decision, quality_score, rationale, evaluation_json
      FROM materialized_evaluations
      WHERE canonical_job_id = ? AND evaluation_context_fingerprint = ?
    `).get(canonicalJobId, fingerprintV1) as any;

    expect(evalV1).toBeDefined();
    const originalDecisionV1 = evalV1.decision;
    const originalScoreV1 = evalV1.quality_score;
    const originalRationaleV1 = evalV1.rationale;
    const originalJsonV1 = evalV1.evaluation_json;

    // 2. Candidate Profile Mutation -> Profile V2
    const mutatedProfile: CandidateProfile = {
      ...profileSnapshot,
      identity: {
        ...profileSnapshot.identity,
        currentTitle: "Chief Technology Officer",
        targetRoles: ["Chief Technology Officer", "VP Engineering"]
      },
      experience: {
        totalYears: 5,
        leadershipYears: 2,
        achievements: ["Junior developer scaling backend services"]
      }
    };

    const snapshotIdV2 = "snap_profile_v2";
    sqliteDb.prepare(`
      INSERT INTO search_plan_snapshots (id, search_plan_id, tenant_id, person_id, snapshot_hash, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(snapshotIdV2, PLAN_ID, TENANT_ID, PERSON_ID, "snap_hash_v2", JSON.stringify(mutatedProfile));

    const fingerprintV2 = computeEvaluationContextFingerprint({
      tenantId: TENANT_ID,
      personId: PERSON_ID,
      searchPlanSnapshotId: snapshotIdV2,
      ontologyVersion: "3.0.0",
      ontologyFingerprint: "onto_hash_v1",
      policyVersion: "v4.1",
      profileVersion: "profile_v2"
    });

    // Prove A: Profile mutation produces distinct context fingerprint
    expect(fingerprintV2).not.toBe(fingerprintV1);

    sqliteDb.prepare(`
      INSERT INTO evaluation_contexts (
        context_fingerprint, tenant_id, person_id, search_plan_snapshot_id,
        ontology_version, ontology_fingerprint, policy_version, profile_version, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `).run(fingerprintV2, TENANT_ID, PERSON_ID, snapshotIdV2, "3.0.0", "onto_hash_v1", "v4.1", "profile_v2");

    const jobIdV2 = "job_replay_v2";
    sqliteDb.prepare(`
      INSERT INTO evaluation_jobs (
        id, tenant_id, person_id, search_plan_id, canonical_job_id,
        opportunity_version, evaluation_context_fingerprint,
        status, attempts, max_attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 0, 3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).run(jobIdV2, TENANT_ID, PERSON_ID, PLAN_ID, canonicalJobId, oppVersion, fingerprintV2);

    const claim2 = await worker.claimNextJob();
    expect(claim2?.id).toBe(jobIdV2);
    const result2 = await worker.processJob(claim2!);
    expect(result2.status).toBe("completed");

    // Fetch new evaluation E2
    const evalV2 = sqliteDb.prepare(`
      SELECT decision, quality_score, rationale, evaluation_json
      FROM materialized_evaluations
      WHERE canonical_job_id = ? AND evaluation_context_fingerprint = ?
    `).get(canonicalJobId, fingerprintV2) as any;

    expect(evalV2).toBeDefined();

    // Prove B: Historical evaluation E1 in database remains 100% byte-for-byte identical after profile mutation
    const evalV1AfterMutation = sqliteDb.prepare(`
      SELECT decision, quality_score, rationale, evaluation_json
      FROM materialized_evaluations
      WHERE canonical_job_id = ? AND evaluation_context_fingerprint = ?
    `).get(canonicalJobId, fingerprintV1) as any;

    expect(evalV1AfterMutation.decision).toBe(originalDecisionV1);
    expect(evalV1AfterMutation.quality_score).toBe(originalScoreV1);
    expect(evalV1AfterMutation.rationale).toBe(originalRationaleV1);
    expect(evalV1AfterMutation.evaluation_json).toBe(originalJsonV1);
  });
});
