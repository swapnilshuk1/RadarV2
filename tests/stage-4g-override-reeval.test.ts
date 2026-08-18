import { describe, it, expect, beforeEach, afterEach } from "vitest";
import DatabaseConstructor from "better-sqlite3";
import { SqliteEvaluationStore } from "../src/data/sqlite/repositories/SqliteEvaluationStore";
import type { DatabaseAdapter } from "../src/data/database/adapter";

describe("Item 5: End-to-End User Override Preservation during Re-evaluation", () => {
  let sqliteDb: any;
  let adapter: DatabaseAdapter;
  let evalStore: SqliteEvaluationStore;

  beforeEach(() => {
    sqliteDb = new DatabaseConstructor(":memory:");
    sqliteDb.exec(`
      CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO people (id, name) VALUES ('swapnil', 'Swapnil Shukla');

      CREATE TABLE opportunities (id TEXT PRIMARY KEY, canonical_title TEXT);
      INSERT INTO opportunities (id, canonical_title) VALUES ('j-200', 'Director Marketing');

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

  it("CRITICAL PROOF: V4 PURSUE -> User PASS -> Profile Changes (STALE) -> V4 Re-evaluates PURSUE -> Effective decision REMAINS PASS", async () => {
    // Step 1: Initial V4 Evaluation produces PURSUE
    const initialInputHash = SqliteEvaluationStore.computeInputHash("profile_v1", "j-200", "v4.1", "v2");
    await evalStore.saveEvaluation({
      personId: "swapnil",
      jobHash: "j-200",
      policyVersion: "v4.1",
      evaluationInputHash: initialInputHash,
      engineVerdict: "PURSUE",
      engineQualityScore: 88.0,
      effectiveDecision: "PURSUE",
      qualityScore: 88.0,
      evaluationStatus: "COMPLETE",
      evaluationJson: JSON.stringify({ jobHash: "j-200", score: 88.0, decision: "PURSUE" }),
    });

    let evalRecord = await evalStore.getEvaluation("swapnil", "j-200");
    expect(evalRecord?.engineVerdict).toBe("PURSUE");
    expect(evalRecord?.effectiveDecision).toBe("PURSUE");
    expect(evalRecord?.userDecisionOverride).toBeNull();

    // Step 2: User explicitly decides to PASS on this role
    await evalStore.setUserDecisionOverride("swapnil", "j-200", "PASS");
    evalRecord = await evalStore.getEvaluation("swapnil", "j-200");
    expect(evalRecord?.engineVerdict).toBe("PURSUE");
    expect(evalRecord?.userDecisionOverride).toBe("PASS");
    expect(evalRecord?.effectiveDecision).toBe("PASS");

    // Step 3: Candidate profile changes -> new input hash (stale evaluation)
    const updatedInputHash = SqliteEvaluationStore.computeInputHash("profile_v2", "j-200", "v4.1", "v2");
    expect(updatedInputHash).not.toBe(initialInputHash);

    // Step 4: V4 Background Worker re-evaluates the opportunity with new profile and still returns PURSUE (score 94)
    await evalStore.saveEvaluation({
      personId: "swapnil",
      jobHash: "j-200",
      policyVersion: "v4.1",
      evaluationInputHash: updatedInputHash,
      engineVerdict: "PURSUE",
      engineQualityScore: 94.0,
      effectiveDecision: "PURSUE", // Engine wants to set PURSUE
      qualityScore: 94.0,
      evaluationStatus: "COMPLETE",
      evaluationJson: JSON.stringify({ jobHash: "j-200", score: 94.0, decision: "PURSUE" }),
    });

    // Step 5: VERIFY: Effective decision strictly preserved as PASS!
    const finalRecord = await evalStore.getEvaluation("swapnil", "j-200");
    expect(finalRecord?.engineVerdict).toBe("PURSUE");
    expect(finalRecord?.engineQualityScore).toBe(94.0);
    expect(finalRecord?.evaluationInputHash).toBe(updatedInputHash);
    expect(finalRecord?.userDecisionOverride).toBe("PASS");
    expect(finalRecord?.effectiveDecision).toBe("PASS"); // MUST NOT BE PURSUE
  });
});
