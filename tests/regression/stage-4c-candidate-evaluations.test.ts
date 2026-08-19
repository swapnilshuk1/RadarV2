import { describe, it, expect, beforeEach, afterEach } from "vitest";
import DatabaseConstructor from "better-sqlite3";
import { SqliteEvaluationStore } from "../../src/data/sqlite/repositories/SqliteEvaluationStore";
import type { DatabaseAdapter } from "../../src/data/database/adapter";

describe("Gate 3: Materialized Candidate Evaluation Persistence & Override Protection", () => {
  let sqliteDb: any;
  let adapter: DatabaseAdapter;
  let evalStore: SqliteEvaluationStore;

  beforeEach(() => {
    sqliteDb = new DatabaseConstructor(":memory:");
    sqliteDb.exec(`
      CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO people (id, name) VALUES ('swapnil', 'Swapnil Shukla');

      CREATE TABLE opportunities (id TEXT PRIMARY KEY, canonical_title TEXT);
      INSERT INTO opportunities (id, canonical_title) VALUES ('j-03b75f450eb3', 'VP Marketing');

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

  it("computes deterministic evaluation_input_hash", () => {
    const hash1 = SqliteEvaluationStore.computeInputHash("prof_v1", "opp_v1", "policy_v4", "ont_v2");
    const hash2 = SqliteEvaluationStore.computeInputHash("prof_v1", "opp_v1", "policy_v4", "ont_v2");
    const hash3 = SqliteEvaluationStore.computeInputHash("prof_v2", "opp_v1", "policy_v4", "ont_v2");

    expect(hash1).toEqual(hash2);
    expect(hash1).not.toEqual(hash3);
  });

  it("upserts evaluation record and reads back cleanly", async () => {
    const record = {
      personId: "swapnil",
      jobHash: "j-03b75f450eb3",
      policyVersion: "v4.1",
      evaluationInputHash: "eval_hash_123",
      engineVerdict: "PURSUE" as const,
      engineQualityScore: 88.5,
      effectiveDecision: "PURSUE" as const,
      qualityScore: 88.5,
      evaluationStatus: "COMPLETE" as const,
      evaluationJson: JSON.stringify({ summary: "High fit" }),
    };

    await evalStore.saveEvaluation(record);

    const fetched = await evalStore.getEvaluation("swapnil", "j-03b75f450eb3");
    expect(fetched).not.toBeNull();
    expect(fetched?.engineVerdict).toBe("PURSUE");
    expect(fetched?.engineQualityScore).toBe(88.5);
    expect(fetched?.userDecisionOverride).toBeNull();
  });

  it("CRITICAL PROOF: protects explicit user decision override during V4 re-evaluation", async () => {
    // 1. Initial V4 evaluation -> PURSUE
    await evalStore.saveEvaluation({
      personId: "swapnil",
      jobHash: "j-03b75f450eb3",
      policyVersion: "v4.1",
      evaluationInputHash: "eval_hash_1",
      engineVerdict: "PURSUE",
      engineQualityScore: 92.0,
      effectiveDecision: "PURSUE",
      qualityScore: 92.0,
      evaluationStatus: "COMPLETE",
      evaluationJson: "{}",
    });

    // 2. User explicitly overrides decision -> PASS
    await evalStore.setUserDecisionOverride("swapnil", "j-03b75f450eb3", "PASS");

    const overridden = await evalStore.getEvaluation("swapnil", "j-03b75f450eb3");
    expect(overridden?.userDecisionOverride).toBe("PASS");
    expect(overridden?.effectiveDecision).toBe("PASS");

    // 3. Candidate profile updates and V4 re-evaluates -> engine says CONSIDER
    await evalStore.saveEvaluation({
      personId: "swapnil",
      jobHash: "j-03b75f450eb3",
      policyVersion: "v4.2",
      evaluationInputHash: "eval_hash_2",
      engineVerdict: "CONSIDER",
      engineQualityScore: 74.0,
      effectiveDecision: "CONSIDER",
      qualityScore: 74.0,
      evaluationStatus: "COMPLETE",
      evaluationJson: "{}",
    });

    // 4. VERIFY: Engine verdict updated to CONSIDER, but user override PASS remains intact!
    const reEvaluated = await evalStore.getEvaluation("swapnil", "j-03b75f450eb3");
    expect(reEvaluated?.engineVerdict).toBe("CONSIDER");
    expect(reEvaluated?.engineQualityScore).toBe(74.0);
    expect(reEvaluated?.userDecisionOverride).toBe("PASS");
    expect(reEvaluated?.effectiveDecision).toBe("PASS");
  });
});
