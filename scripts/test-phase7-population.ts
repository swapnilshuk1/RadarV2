import { describe, it, expect, beforeEach, afterEach } from "vitest";
import DatabaseConstructor from "better-sqlite3";
import { SqliteEvaluationStore } from "../src/data/sqlite/repositories/SqliteEvaluationStore";
import { SqliteDecisionSupportStore } from "../src/data/sqlite/repositories/SqliteDecisionSupportStore";
import { OpportunityService } from "../src/lib/intelligence/opportunity-service";
import type { DatabaseAdapter } from "../src/data/database/adapter";
import { setStorageProvider, resetStorageProvider } from "../src/data/sqlite/provider";

describe("RADAR V4 Phase 7: Population Metrics & Bounded Retrieval Suite", () => {
  let sqliteDb: any;
  let adapter: DatabaseAdapter;
  let evalStore: SqliteEvaluationStore;
  let decisionStore: SqliteDecisionSupportStore;

  beforeEach(() => {
    sqliteDb = new DatabaseConstructor(":memory:");
    sqliteDb.exec(`
      CREATE TABLE people (id TEXT PRIMARY KEY, name TEXT);
      INSERT INTO people (id, name) VALUES ('user_a', 'Alice'), ('user_b', 'Bob');

      CREATE TABLE candidate_evaluations (
        person_id              TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
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

      CREATE TABLE decisions (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id      TEXT NOT NULL,
        opportunity_id TEXT NOT NULL,
        action         TEXT NOT NULL,
        reason         TEXT,
        updated_at     TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(person_id, opportunity_id)
      );

      CREATE TABLE evaluation_jobs (
        id TEXT PRIMARY KEY, person_id TEXT, job_hash TEXT, input_hash TEXT, status TEXT, attempts INTEGER, available_at TEXT, created_at TEXT
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
    decisionStore = new SqliteDecisionSupportStore(adapter);

    setStorageProvider({
      evaluations: evalStore,
      decisions: decisionStore,
      sources: {} as any,
      companies: {} as any,
      opportunities: {} as any,
      acquisition: {} as any,
      knowledge: {} as any,
      reasoning: {} as any,
      people: {} as any,
    });
  });

  afterEach(() => {
    resetStorageProvider();
    sqliteDb.close();
  });

  async function seedEvaluations(personId: string, count: number) {
    for (let i = 1; i <= count; i++) {
      const score = 100 - i * 0.1;
      const verdict = i <= 10 ? "PURSUE" : i <= 40 ? "CONSIDER" : "PASS";
      const oppJson = JSON.stringify({
        jobHash: `job_${personId}_${i}`,
        title: `Opportunity ${i}`,
        company: `Company ${i}`,
        engineRecommendation: {
          jobHash: `job_${personId}_${i}`,
          engineVerdict: verdict,
          qualityScore: score,
        },
      });

      await evalStore.saveEvaluation({
        personId,
        jobHash: `job_${personId}_${i}`,
        policyVersion: "v4.1",
        evaluationInputHash: `hash_${i}`,
        engineVerdict: verdict as any,
        engineQualityScore: score,
        effectiveDecision: verdict as any,
        qualityScore: score,
        evaluationStatus: "COMPLETE",
        evaluationJson: oppJson,
      });
    }
  }

  it("CASE A: Under boundary (50 evaluations) -> screened = 50, feed = 50", async () => {
    await seedEvaluations("user_a", 50);

    const metrics = await OpportunityService.getMetricsForUser("user_a");
    const feed = await OpportunityService.listForUser("user_a");

    expect(metrics.totalScreened).toBe(50);
    expect(feed.length).toBe(50);
  });

  it("CASE B: Boundary (100 evaluations) -> screened = 100, feed = 100", async () => {
    await seedEvaluations("user_a", 100);

    const metrics = await OpportunityService.getMetricsForUser("user_a");
    const feed = await OpportunityService.listForUser("user_a");

    expect(metrics.totalScreened).toBe(100);
    expect(feed.length).toBe(100);
  });

  it("CASE C & D: Above boundary (101+ evaluations) -> totalScreened = N, feed = 100 bounded", async () => {
    await seedEvaluations("user_a", 150);

    const metrics = await OpportunityService.getMetricsForUser("user_a");
    const feed = await OpportunityService.listForUser("user_a");

    expect(metrics.totalScreened).toBe(150);
    expect(feed.length).toBe(100); // Bounded top-100 feed
  });

  it("CASE E: User decision outside top-100 feed appears in listDecidedForUser", async () => {
    await seedEvaluations("user_a", 150);

    // Record decision on job_user_a_120 (ranked well outside top 100)
    await decisionStore.recordUserDecision("user_a", "job_user_a_120", "PURSUE", "Strategic fit");

    const decidedOpps = await OpportunityService.listDecidedForUser("user_a");
    expect(decidedOpps.map((o) => o.jobHash)).toContain("job_user_a_120");
  });

  it("CASE F: Engine/User separation invariant", async () => {
    await seedEvaluations("user_a", 20);

    const metrics = await OpportunityService.getMetricsForUser("user_a");
    expect(metrics.totalDecisions).toBe(0); // Engine PURSUEs do not count as user decisions

    await decisionStore.recordUserDecision("user_a", "job_user_a_1", "PURSUE", "Explicit choice");
    const metricsAfter = await OpportunityService.getMetricsForUser("user_a");
    expect(metricsAfter.totalDecisions).toBe(1);
  });

  it("CASE G: User isolation invariant", async () => {
    await seedEvaluations("user_a", 100);
    await seedEvaluations("user_b", 40);

    const metricsA = await OpportunityService.getMetricsForUser("user_a");
    const metricsB = await OpportunityService.getMetricsForUser("user_b");

    expect(metricsA.totalScreened).toBe(100);
    expect(metricsB.totalScreened).toBe(40);
  });

  it("CASE H: Dossier point lookup for rank >100 opportunity", async () => {
    await seedEvaluations("user_a", 150);

    const opp = await OpportunityService.getForUser("user_a", "job_user_a_125");
    expect(opp).toBeDefined();
    expect(opp?.jobHash).toBe("job_user_a_125");
  });

  it("CASE I: Queue total reflects authoritative full population", async () => {
    await seedEvaluations("user_a", 120);

    const adj = await evalStore.getAdjacentEvaluations("user_a", "job_user_a_110");
    expect(adj.totalCount).toBe(120);
  });

  it("CASE J: Deterministic neighbor navigation across full population", async () => {
    await seedEvaluations("user_a", 150);

    const neighbours = await OpportunityService.neighboursForUser("user_a", "job_user_a_105");
    expect(neighbours.prev).toBeDefined();
    expect(neighbours.next).toBeDefined();
  });
});
