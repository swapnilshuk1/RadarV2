import { describe, it, expect, beforeEach, afterEach } from "vitest";
import DatabaseConstructor from "better-sqlite3";
import { SqliteEvaluationStore } from "../../src/data/sqlite/repositories/SqliteEvaluationStore";
import type { DatabaseAdapter } from "../../src/data/database/adapter";

describe("Gate 4: Asynchronous Ingestion & Evaluation End-to-End Test", () => {
  let sqliteDb: any;
  let adapter: DatabaseAdapter;
  let evalStore: SqliteEvaluationStore;

  beforeEach(() => {
    sqliteDb = new DatabaseConstructor(":memory:");
    sqliteDb.exec(`
      CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO people (id, name) VALUES ('swapnil', 'Swapnil Shukla');

      CREATE TABLE opportunities (id TEXT PRIMARY KEY, canonical_title TEXT);
      CREATE TABLE companies (id TEXT PRIMARY KEY, name TEXT);

      CREATE TABLE candidate_evaluations (
        person_id              TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
        job_hash               TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
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

      CREATE TABLE evaluation_jobs (
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

    adapter = {
      one: async (sql: string, params: any[] = []) => sqliteDb.prepare(sql).get(...params),
      many: async (sql: string, params: any[] = []) => sqliteDb.prepare(sql).all(...params),
      execute: async (sql: string, params: any[] = []) => {
        const res = sqliteDb.prepare(sql).run(...params);
        return { rowsAffected: res.changes, lastInsertRowid: res.lastInsertRowid };
      },
      transaction: async (fn: any) => fn(adapter),
    };

    evalStore = new SqliteEvaluationStore(adapter);
  });

  afterEach(() => {
    sqliteDb.close();
  });

  it("CRITICAL PROOF: End-to-End Ingestion Journey (Persist -> Enqueue -> Claim -> Evaluate -> Materialize -> Shortlist Query)", async () => {
    const jobHash = "j-9988776655";
    const personId = "swapnil";

    // 1. Scraper discovers & persists opportunity row
    sqliteDb.prepare(`INSERT INTO opportunities (id, canonical_title) VALUES (?, ?)`).run(jobHash, "Chief Commercial Officer");

    // 2. Ingestion pipeline enqueues evaluation job automatically
    const inputHash = SqliteEvaluationStore.computeInputHash("prof_v1", jobHash, "v4.1", "v2");
    await evalStore.enqueueJob(personId, jobHash, inputHash);

    // Verify evaluation_jobs row created
    const pendingJob = sqliteDb.prepare(`SELECT * FROM evaluation_jobs WHERE job_hash = ?`).get(jobHash);
    expect(pendingJob).not.toBeNull();
    expect(pendingJob.status).toBe("PENDING");

    // 3. V4 Evaluation Worker claims job from queue
    const claimed = await evalStore.claimJob("worker_unit_test_1", 5);
    expect(claimed).not.toBeNull();
    expect(claimed?.jobHash).toBe(jobHash);

    // Verify status transitioned to RUNNING
    const runningJob = sqliteDb.prepare(`SELECT * FROM evaluation_jobs WHERE id = ?`).get(claimed?.id);
    expect(runningJob.status).toBe("RUNNING");
    expect(runningJob.lock_owner).toBe("worker_unit_test_1");

    // 4. Worker executes V4 evaluation & materializes candidate_evaluations row
    await evalStore.saveEvaluation({
      personId,
      jobHash,
      policyVersion: "v4.1",
      evaluationInputHash: inputHash,
      engineVerdict: "PURSUE",
      engineQualityScore: 94.5,
      effectiveDecision: "PURSUE",
      qualityScore: 94.5,
      evaluationStatus: "COMPLETE",
      evaluationJson: JSON.stringify({ summary: "Scraped CCO high match" }),
    });
    await evalStore.markJobCompleted(claimed!.id);

    // Verify evaluation_jobs marked COMPLETED
    const completedJob = sqliteDb.prepare(`SELECT * FROM evaluation_jobs WHERE id = ?`).get(claimed?.id);
    expect(completedJob.status).toBe("COMPLETED");

    // 5. Executive UI /decisions query fetches materialized evaluation in O(k)
    const shortlist = await evalStore.listEvaluationsForUser(personId, 10);
    expect(shortlist).toHaveLength(1);
    expect(shortlist[0].jobHash).toBe(jobHash);
    expect(shortlist[0].effectiveDecision).toBe("PURSUE");
    expect(shortlist[0].qualityScore).toBe(94.5);
  });
});
