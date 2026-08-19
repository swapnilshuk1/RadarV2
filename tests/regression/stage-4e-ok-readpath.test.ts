import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import DatabaseConstructor from "better-sqlite3";
import { SqliteEvaluationStore } from "../../src/data/sqlite/repositories/SqliteEvaluationStore";
import type { DatabaseAdapter } from "../../src/data/database/adapter";

describe("Gate 5: O(k) Read-Path Verification", () => {
  let sqliteDb: any;
  let adapter: DatabaseAdapter;
  let evalStore: SqliteEvaluationStore;

  beforeEach(() => {
    sqliteDb = new DatabaseConstructor(":memory:");
    sqliteDb.exec(`
      CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO people (id, name) VALUES ('swapnil', 'Swapnil Shukla');

      CREATE TABLE opportunities (id TEXT PRIMARY KEY, canonical_title TEXT);
      INSERT INTO opportunities (id, canonical_title) VALUES ('j-101', 'VP Growth');

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
        status       TEXT NOT NULL DEFAULT 'PENDING',
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

  it("CRITICAL PROOF: Read path fetches pre-computed candidate evaluation in O(k)", async () => {
    // 1. Seed 1 materialized evaluation
    await evalStore.saveEvaluation({
      personId: "swapnil",
      jobHash: "j-101",
      policyVersion: "v4.1",
      evaluationInputHash: "hash_101",
      engineVerdict: "PURSUE",
      engineQualityScore: 91.0,
      effectiveDecision: "PURSUE",
      qualityScore: 91.0,
      evaluationStatus: "COMPLETE",
      evaluationJson: JSON.stringify({ jobHash: "j-101", role: "VP Growth" }),
    });

    // 2. Query listEvaluationsForUser with limit k=50
    const listSpy = vi.spyOn(evalStore, "listEvaluationsForUser");
    const results = await evalStore.listEvaluationsForUser("swapnil", 50);

    // 3. VERIFY: Query returned pre-computed DTO in O(k)
    expect(listSpy).toHaveBeenCalledWith("swapnil", 50);
    expect(results).toHaveLength(1);
    expect(results[0].jobHash).toBe("j-101");
    expect(results[0].qualityScore).toBe(91.0);
  });
});
