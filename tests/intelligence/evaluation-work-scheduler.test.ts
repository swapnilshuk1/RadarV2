import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { EvaluationWorkScheduler } from "@/evaluation/work-scheduler";
import { computeContentHash } from "../../src/lib/domain/canonical_identity";

describe("EvaluationWorkScheduler staged-v8 recovery", () => {
  let db: SqliteAdapter;
  const identity = {
    tenantId: "tenant_A",
    personId: "person_A",
    searchPlanId: "plan_A",
    canonicalJobId: "job",
    opportunityVersion: "version",
    evaluationContextFingerprint: "staged-context",
  };

  beforeEach(async () => {
    db = new SqliteAdapter(new Database(":memory:"));
    await setupLineageTestFixture(db);
    await db.execute(
      `INSERT INTO evaluation_contexts (
        context_fingerprint,tenant_id,person_id,search_plan_snapshot_id,
        ontology_version,ontology_fingerprint,policy_version,profile_version
      ) VALUES ('staged-context','tenant_A','person_A','sps_A','v1','hash_ontology','staged-v8','profile')`,
    );
    await db.execute(
      `INSERT INTO canonical_opportunities(id,source,source_job_id,canonical_url)
       VALUES ('job','LinkedIn','source-job','https://example.com/job')`,
    );
    await db.execute(
      `INSERT INTO opportunity_versions(id,canonical_job_id,content_hash,job_title,raw_content)
       VALUES ('version','job',?,'Head of Growth','Job description')`,
      [
        computeContentHash({
          title: "Head of Growth",
          companyName: null,
          location: null,
          employmentType: null,
          rawContent: "Job description",
        }),
      ],
    );
    await db.execute(
      `INSERT INTO search_plan_candidates(
        tenant_id,person_id,search_plan_id,canonical_job_id,opportunity_version,attention_decision
      ) VALUES ('tenant_A','person_A','plan_A','job','version','CANDIDATE')`,
    );
  });

  async function completeEnrichment() {
    await db.execute(
      `INSERT INTO enrichment_jobs(
        id,job_hash,canonical_job_id,opportunity_version,pipeline_version,status
      ) VALUES ('enrich-job','source-job','job','version','1.0.0','COMPLETE')`,
    );
  }

  it("does not create evaluation work when exact enrichment does not exist", async () => {
    await expect(new EvaluationWorkScheduler(db).ensureWork(identity)).resolves.toEqual({
      jobId: null,
      queued: false,
      requirementStatus: "NO_ENRICHMENT",
    });
    expect(await db.one("SELECT COUNT(*) n FROM evaluation_requirements")).toEqual({ n: 0 });
    expect(await db.one("SELECT COUNT(*) n FROM evaluation_jobs")).toEqual({ n: 0 });
  });

  it("re-enters a recoverable evaluation dead-letter on the same queue row", async () => {
    await completeEnrichment();
    const scheduler = new EvaluationWorkScheduler(db);
    const scheduled = await scheduler.ensureWork(identity);
    const originalId = scheduled.jobId;
    expect(originalId).not.toBeNull();

    await db.execute(
      `UPDATE evaluation_jobs
       SET status='staged_dead_letter', attempts=3, last_error='MODEL_INVALID_OUTPUT: bad',
           completed_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      [originalId],
    );
    await db.execute(
      `UPDATE evaluation_requirements
       SET status='FAILED', blocked_reason='EVALUATION_DEAD_LETTER:MODEL_INVALID_OUTPUT: bad'
       WHERE evaluation_context_fingerprint='staged-context'`,
    );

    await expect(
      scheduler.retryRecoverableDeadLetters(
        { tenantId: "tenant_A", personId: "person_A" },
        "staged-context",
      ),
    ).resolves.toBe(1);

    expect(
      await db.one(
        "SELECT id,status,attempts,last_error,completed_at FROM evaluation_jobs WHERE id=?",
        [originalId],
      ),
    ).toEqual({
      id: originalId,
      status: "staged_pending",
      attempts: 0,
      last_error: null,
      completed_at: null,
    });
    expect(
      await db.one(
        "SELECT status,blocked_reason FROM evaluation_requirements WHERE evaluation_context_fingerprint='staged-context'",
      ),
    ).toEqual({ status: "READY", blocked_reason: null });
    expect(await db.one("SELECT COUNT(*) n FROM evaluation_jobs")).toEqual({ n: 1 });
  });

  it("does not resurrect deterministic unavailable-input failures", async () => {
    await completeEnrichment();
    const scheduler = new EvaluationWorkScheduler(db);
    const scheduled = await scheduler.ensureWork(identity);

    await db.execute(
      `UPDATE evaluation_jobs
       SET status='staged_dead_letter', attempts=3,
           last_error='STAGED_INPUT_UNAVAILABLE:MISSING_SOURCE'
       WHERE id=?`,
      [scheduled.jobId],
    );
    await db.execute(
      `UPDATE evaluation_requirements
       SET status='FAILED', blocked_reason='STAGED_INPUT_UNAVAILABLE:MISSING_SOURCE'
       WHERE evaluation_context_fingerprint='staged-context'`,
    );

    await expect(
      scheduler.retryRecoverableDeadLetters(
        { tenantId: "tenant_A", personId: "person_A" },
        "staged-context",
      ),
    ).resolves.toBe(0);

    expect(await db.one("SELECT status FROM evaluation_jobs WHERE id=?", [scheduled.jobId]))
      .toEqual({ status: "staged_dead_letter" });
    expect(
      await db.one(
        "SELECT status,blocked_reason FROM evaluation_requirements WHERE evaluation_context_fingerprint='staged-context'",
      ),
    ).toEqual({
      status: "FAILED",
      blocked_reason: "STAGED_INPUT_UNAVAILABLE:MISSING_SOURCE",
    });
  });
});
