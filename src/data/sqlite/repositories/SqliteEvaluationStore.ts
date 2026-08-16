import type { DatabaseAdapter } from "../../database/adapter";

export interface CandidateEvaluationRecord {
  personId: string;
  jobHash: string;
  policyVersion: string;
  evaluationInputHash: string;
  engineVerdict: "PURSUE" | "CONSIDER" | "PASS";
  engineQualityScore: number;
  userDecisionOverride?: "PURSUE" | "CONSIDER" | "PASS" | null;
  effectiveDecision: "PURSUE" | "CONSIDER" | "PASS";
  qualityScore: number;
  evaluationStatus: "COMPLETE" | "SPARSE_SPEC" | "DEFERRED" | "FAILED";
  evaluationJson: string;
  updatedAt?: string;
}

export interface EvaluationJobRecord {
  id: string;
  personId: string;
  jobHash: string;
  inputHash: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "SUPERSEDED";
  attempts: number;
  lockOwner?: string | null;
  lockedAt?: string | null;
  availableAt: string;
  completedAt?: string | null;
  lastError?: string | null;
  createdAt?: string;
}

export class SqliteEvaluationStore {
  private schemaInitPromise: Promise<void> | null = null;

  constructor(private db: DatabaseAdapter) {}

  private async ensureSchema(): Promise<void> {
    if (!this.schemaInitPromise) {
      this.schemaInitPromise = (async () => {
        try {
          await this.db.execute(`
            CREATE TABLE IF NOT EXISTS candidate_evaluations (
              person_id              TEXT NOT NULL,
              job_hash               TEXT NOT NULL,
              policy_version         TEXT NOT NULL,
              evaluation_input_hash  TEXT NOT NULL,
              engine_verdict         TEXT NOT NULL CHECK(engine_verdict IN ('PURSUE', 'CONSIDER', 'PASS')),
              engine_quality_score   REAL NOT NULL,
              user_decision_override TEXT CHECK(user_decision_override IN ('PURSUE', 'CONSIDER', 'PASS')),
              effective_decision     TEXT NOT NULL CHECK(effective_decision IN ('PURSUE', 'CONSIDER', 'PASS')),
              quality_score          REAL NOT NULL,
              evaluation_status      TEXT NOT NULL DEFAULT 'COMPLETE' CHECK(evaluation_status IN ('COMPLETE', 'SPARSE_SPEC', 'DEFERRED', 'FAILED')),
              evaluation_json        TEXT NOT NULL,
              updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
              PRIMARY KEY (person_id, job_hash)
            );
          `);
          await this.db.execute(`
            CREATE TABLE IF NOT EXISTS evaluation_jobs (
              id           TEXT PRIMARY KEY,
              person_id    TEXT NOT NULL,
              job_hash     TEXT NOT NULL,
              input_hash   TEXT NOT NULL,
              status       TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SUPERSEDED')),
              attempts     INTEGER NOT NULL DEFAULT 0,
              lock_owner   TEXT,
              locked_at    TEXT,
              available_at TEXT NOT NULL DEFAULT (datetime('now')),
              completed_at TEXT,
              last_error   TEXT,
              created_at   TEXT NOT NULL DEFAULT (datetime('now')),
              UNIQUE(person_id, job_hash, input_hash)
            );
          `);
        } catch (err: any) {
          console.error("⚠️ [SqliteEvaluationStore] Schema init notice:", err?.message || err);
        }
      })();
    }
    return this.schemaInitPromise;
  }

  /**
   * Computes deterministic evaluation_input_hash for candidate-opportunity inputs.
   */
  public static computeInputHash(
    candidateProfileVersion: string,
    opportunityVersion: string,
    policyVersion: string,
    ontologyVersion: string = "v2"
  ): string {
    const raw = `${candidateProfileVersion}:${opportunityVersion}:${policyVersion}:${ontologyVersion}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return `eval_hash_${Math.abs(hash).toString(16)}`;
  }

  /**
   * Upserts candidate evaluation while strictly protecting any existing user_decision_override.
   */
  async saveEvaluation(record: CandidateEvaluationRecord): Promise<void> {
    await this.ensureSchema();
    // Check if an existing user_decision_override exists
    const existing = await this.getEvaluation(record.personId, record.jobHash);
    const effectiveOverride = existing?.userDecisionOverride || record.userDecisionOverride || null;
    const finalEffectiveDecision = effectiveOverride || record.engineVerdict;
    const finalQualityScore = effectiveOverride ? 100.0 : record.engineQualityScore;

    await this.db.execute(
      `
      INSERT INTO candidate_evaluations (
        person_id, job_hash, policy_version, evaluation_input_hash,
        engine_verdict, engine_quality_score, user_decision_override,
        effective_decision, quality_score, evaluation_status, evaluation_json, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(person_id, job_hash) DO UPDATE SET
        policy_version = excluded.policy_version,
        evaluation_input_hash = excluded.evaluation_input_hash,
        engine_verdict = excluded.engine_verdict,
        engine_quality_score = excluded.engine_quality_score,
        user_decision_override = COALESCE(candidate_evaluations.user_decision_override, excluded.user_decision_override),
        effective_decision = COALESCE(candidate_evaluations.user_decision_override, excluded.effective_decision),
        quality_score = CASE WHEN candidate_evaluations.user_decision_override IS NOT NULL THEN 100.0 ELSE excluded.quality_score END,
        evaluation_status = excluded.evaluation_status,
        evaluation_json = excluded.evaluation_json,
        updated_at = CURRENT_TIMESTAMP
      `,
      [
        record.personId,
        record.jobHash,
        record.policyVersion,
        record.evaluationInputHash,
        record.engineVerdict,
        record.engineQualityScore,
        effectiveOverride,
        finalEffectiveDecision,
        finalQualityScore,
        record.evaluationStatus || "COMPLETE",
        record.evaluationJson,
      ]
    );
  }

  /**
   * Sets or clears explicit user decision override (PURSUE, CONSIDER, PASS).
   */
  async setUserDecisionOverride(
    personId: string,
    jobHash: string,
    userOverride: "PURSUE" | "CONSIDER" | "PASS" | null
  ): Promise<void> {
    await this.ensureSchema();
    const existing = await this.getEvaluation(personId, jobHash);
    if (!existing) return;

    const newEffectiveDecision = userOverride || existing.engineVerdict;
    const newQualityScore = userOverride ? 100.0 : existing.engineQualityScore;

    await this.db.execute(
      `
      UPDATE candidate_evaluations
      SET user_decision_override = ?,
          effective_decision = ?,
          quality_score = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE person_id = ? AND job_hash = ?
      `,
      [userOverride, newEffectiveDecision, newQualityScore, personId, jobHash]
    );
  }

  /**
   * Retrieves single candidate evaluation.
   */
  async getEvaluation(personId: string, jobHash: string): Promise<CandidateEvaluationRecord | null> {
    await this.ensureSchema();
    const row = await this.db.one<any>(
      `SELECT * FROM candidate_evaluations WHERE person_id = ? AND job_hash = ?`,
      [personId, jobHash]
    );
    if (!row) return null;
    return this.mapRow(row);
  }

  /**
   * Queries evaluated candidate shortlist O(k) with indexed sorting.
   */
  async listEvaluationsForUser(personId: string, limit = 50): Promise<CandidateEvaluationRecord[]> {
    await this.ensureSchema();
    const rows = await this.db.many<any>(
      `
      SELECT * FROM candidate_evaluations
      WHERE person_id = ?
      ORDER BY quality_score DESC
      LIMIT ?
      `,
      [personId, limit]
    );
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * Enqueues evaluation job in evaluation_jobs queue.
   */
  async enqueueJob(personId: string, jobHash: string, inputHash: string): Promise<void> {
    await this.ensureSchema();
    const jobId = `job_${personId}_${jobHash}_${inputHash.slice(0, 8)}`;
    await this.db.execute(
      `
      INSERT INTO evaluation_jobs (id, person_id, job_hash, input_hash, status, attempts, available_at, created_at)
      VALUES (?, ?, ?, ?, 'PENDING', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(person_id, job_hash, input_hash) DO UPDATE SET
        status = CASE WHEN evaluation_jobs.status = 'FAILED' THEN 'PENDING' ELSE evaluation_jobs.status END,
        available_at = CURRENT_TIMESTAMP
      `,
      [jobId, personId, jobHash, inputHash]
    );
  }

  /**
   * Claims next available job from queue with lease recovery timeout (default 5 mins).
   */
  async claimJob(lockOwner: string, leaseTimeoutMinutes = 5): Promise<EvaluationJobRecord | null> {
    await this.ensureSchema();
    // Reclaim stale RUNNING jobs where locked_at < NOW - leaseTimeout
    await this.db.execute(
      `
      UPDATE evaluation_jobs
      SET status = 'PENDING', lock_owner = NULL, locked_at = NULL
      WHERE status = 'RUNNING'
        AND datetime(locked_at, '+' || ? || ' minutes') < datetime('now')
      `,
      [leaseTimeoutMinutes]
    );

    // Find first PENDING job
    const row = await this.db.one<any>(
      `
      SELECT * FROM evaluation_jobs
      WHERE status = 'PENDING' AND datetime(available_at) <= datetime('now')
      ORDER BY created_at ASC
      LIMIT 1
      `
    );

    if (!row) return null;

    // Lock the claimed job
    await this.db.execute(
      `
      UPDATE evaluation_jobs
      SET status = 'RUNNING', lock_owner = ?, locked_at = CURRENT_TIMESTAMP, attempts = attempts + 1
      WHERE id = ?
      `,
      [lockOwner, row.id]
    );

    return {
      id: row.id,
      personId: row.person_id,
      jobHash: row.job_hash,
      inputHash: row.input_hash,
      status: "RUNNING",
      attempts: row.attempts + 1,
      lockOwner,
      lockedAt: new Date().toISOString(),
      availableAt: row.available_at,
    };
  }

  /**
   * Marks job COMPLETED in queue.
   */
  async markJobCompleted(jobId: string): Promise<void> {
    await this.db.execute(
      `
      UPDATE evaluation_jobs
      SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, lock_owner = NULL
      WHERE id = ?
      `,
      [jobId]
    );
  }

  /**
   * Marks job FAILED or SUPERSEDED in queue.
   */
  async markJobFailed(jobId: string, error: string, isSuperseded = false): Promise<void> {
    await this.db.execute(
      `
      UPDATE evaluation_jobs
      SET status = ?, last_error = ?, lock_owner = NULL
      WHERE id = ?
      `,
      [isSuperseded ? "SUPERSEDED" : "FAILED", error, jobId]
    );
  }

  private mapRow(r: any): CandidateEvaluationRecord {
    return {
      personId: r.person_id,
      jobHash: r.job_hash,
      policyVersion: r.policy_version,
      evaluationInputHash: r.evaluation_input_hash,
      engineVerdict: r.engine_verdict,
      engineQualityScore: r.engine_quality_score,
      userDecisionOverride: r.user_decision_override,
      effectiveDecision: r.effective_decision,
      qualityScore: r.quality_score,
      evaluationStatus: r.evaluation_status,
      evaluationJson: r.evaluation_json,
      updatedAt: r.updated_at,
    };
  }
}
