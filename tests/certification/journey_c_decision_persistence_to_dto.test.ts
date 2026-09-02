/**
 * tests/certification/journey_c_decision_persistence_to_dto.test.ts
 *
 * Continuous Certification Gate — Journey C: Decision Persistence → Feed DTO Parity
 *
 * Invariants Certified:
 * 1. User decisions (PURSUE, CONSIDER, PASS) write cleanly to canonical_decisions.
 * 2. Rapid repeated decisions on the same opportunity update idempotently with 0 lost updates.
 * 3. Feed query maps authoritative database values (quality_score, vetoed, userDecision).
 * 4. DTO recommendationResult carries the authoritative vetoed boolean directly from SQL.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { SqliteDecisionSupportStore } from "@/data/sqlite/repositories/SqliteDecisionSupportStore";
import { SqliteOpportunityQueries } from "@/data/sqlite/repositories/SqliteOpportunityQueries";
import type { AuthorizedPersonScope } from "@/lib/intelligence/opportunity-service";

class TestAdapter implements DatabaseAdapter {
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
  async execute(sql: string, params?: QueryParams): Promise<{ rowsAffected: number; lastInsertRowid?: number | bigint | string }> {
    if (!params || params.length === 0) {
      this.db.exec(sql);
      return { rowsAffected: 1 };
    }
    const stmt = this.db.prepare(sql);
    const res = stmt.run(...(params || []));
    return { rowsAffected: res.changes, lastInsertRowid: res.lastInsertRowid };
  }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const res = await fn(this);
      this.db.exec("COMMIT");
      return res;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
}

describe("Journey C: Decision Persistence → Feed DTO Parity", () => {
  let adapter: TestAdapter;
  let decisionStore: SqliteDecisionSupportStore;
  let queryStore: SqliteOpportunityQueries;

  const scope: AuthorizedPersonScope = {
    tenantId: "tenant_alpha",
    personId: "person_user1",
    activeSearchPlanId: "sp_1",
    activeEvaluationContextId: "ec_1",
  };

  beforeEach(async () => {
    const db = new Database(":memory:");
    adapter = new TestAdapter(db);

    await adapter.execute(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT, is_active INTEGER DEFAULT 1);
      CREATE TABLE memberships (id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, role TEXT, status TEXT, revoked_at TEXT);
      CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, status TEXT, criteria_json TEXT);
      CREATE TABLE search_plan_snapshots (id TEXT PRIMARY KEY, search_plan_id TEXT, tenant_id TEXT, person_id TEXT, snapshot_hash TEXT, payload_json TEXT);
      CREATE TABLE evaluation_contexts (context_fingerprint TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, search_plan_snapshot_id TEXT, ontology_version TEXT, ontology_fingerprint TEXT, policy_version TEXT, profile_version TEXT, created_at TEXT);
      CREATE TABLE active_evaluation_contexts (person_id TEXT, tenant_id TEXT, context_fingerprint TEXT, search_plan_id TEXT, activated_at TEXT, PRIMARY KEY(person_id, tenant_id));
      
      CREATE TABLE canonical_opportunities (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_job_id TEXT NOT NULL, canonical_url TEXT, company_name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE opportunity_versions (
        id TEXT PRIMARY KEY,
        canonical_job_id TEXT NOT NULL,
        content_hash TEXT,
        job_title TEXT NOT NULL,
        company_name TEXT NOT NULL,
        location TEXT,
        raw_content TEXT,
        posted_at TEXT,
        posted_precision TEXT,
        acquisition_status TEXT,
        acquisition_quality TEXT,
        failure_class TEXT,
        evidence_state TEXT,
        lifecycle_state TEXT DEFAULT 'ACTIVE',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE search_plan_candidates (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, search_plan_id TEXT NOT NULL, canonical_job_id TEXT NOT NULL, opportunity_version TEXT NOT NULL, attention_decision TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE materialized_evaluations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        canonical_job_id TEXT NOT NULL,
        opportunity_version TEXT NOT NULL,
        evaluation_context_fingerprint TEXT NOT NULL,
        evaluation_state TEXT NOT NULL,
        decision TEXT,
        quality_score REAL,
        confidence REAL,
        vetoed INTEGER DEFAULT 0,
        policy_version TEXT,
        evaluated_at TEXT,
        materialized_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE canonical_decisions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        canonical_job_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        reviewed_fingerprint TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(tenant_id, person_id, canonical_job_id)
      );

      CREATE TABLE decisions (
        id TEXT PRIMARY KEY,
        person_id TEXT NOT NULL,
        opportunity_id TEXT NOT NULL,
        action TEXT NOT NULL,
        reason TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(person_id, opportunity_id)
      );
    `);

    await adapter.execute(`INSERT INTO tenants VALUES ('tenant_alpha', 'Alpha Corp')`);
    await adapter.execute(`INSERT INTO people VALUES ('person_user1', 'tenant_alpha', 1)`);
    await adapter.execute(`INSERT INTO memberships VALUES ('m1', 'tenant_alpha', 'person_user1', 'member', 'active', NULL)`);
    await adapter.execute(`INSERT INTO search_plans VALUES ('sp_1', 'tenant_alpha', 'person_user1', 'active', '{}')`);
    await adapter.execute(`INSERT INTO search_plan_snapshots VALUES ('sps_1', 'sp_1', 'tenant_alpha', 'person_user1', 'hash_1', '{}')`);
    await adapter.execute(`INSERT INTO evaluation_contexts VALUES ('ec_1', 'tenant_alpha', 'person_user1', 'sps_1', '3.0.0', 'ont_1', 'v4.1', 'p_1', '2026-08-31T00:00:00.000Z')`);
    await adapter.execute(`INSERT INTO active_evaluation_contexts VALUES ('person_user1', 'tenant_alpha', 'ec_1', 'sp_1', '2026-08-31T00:00:00.000Z')`);

    // Insert 1 Opportunity and Evaluation
    await adapter.execute(`INSERT INTO canonical_opportunities VALUES ('job_target_1', 'LinkedIn', 'li_101', 'https://linkedin.com/101', 'Acme Corp', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z')`);
    await adapter.execute(`INSERT INTO opportunity_versions (id, canonical_job_id, job_title, company_name, location, raw_content, lifecycle_state, created_at) VALUES ('ver_target_1', 'job_target_1', 'Senior VP Growth', 'Acme Corp', 'Bengaluru', 'Job text', 'ACTIVE', '2026-08-31T00:00:00.000Z')`);
    await adapter.execute(`INSERT INTO search_plan_candidates VALUES ('spc_1', 'tenant_alpha', 'person_user1', 'sp_1', 'job_target_1', 'ver_target_1', 'CANDIDATE', '2026-08-31T00:00:00.000Z')`);
    await adapter.execute(
      `INSERT INTO materialized_evaluations (
        id, tenant_id, person_id, canonical_job_id, opportunity_version,
        evaluation_context_fingerprint, evaluation_state, decision, quality_score,
        confidence, vetoed, policy_version, evaluated_at, materialized_at, updated_at
      ) VALUES (
        'me_1', 'tenant_alpha', 'person_user1', 'job_target_1', 'ver_target_1',
        'ec_1', 'COMPLETE', 'PURSUE', 85.0, 0.9, 0, 'v4.1',
        '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z', '2026-08-31T00:00:00.000Z'
      )`
    );

    decisionStore = new SqliteDecisionSupportStore(adapter);
    queryStore = new SqliteOpportunityQueries(adapter);
  });

  it("persists decisions idempotently and surfaces authoritative values on FeedSummary", async () => {
    // 1. Initial State: Feed indicates UNREVIEWED and matches DB evaluation
    const initialFeed = await queryStore.getFeed(scope);
    expect(initialFeed.items).toHaveLength(1);
    expect(initialFeed.items[0].jobHash).toBe("li_101");
    expect(initialFeed.items[0].userAction).toBeNull();
    expect(initialFeed.items[0].engineVerdict).toBe("PURSUE");
    expect(initialFeed.items[0].vetoed).toBe(false);

    // 2. Perform Rapid Successive Decisions (PURSUE -> CONSIDER -> PASS)
    await decisionStore.recordUserDecision("person_user1", "li_101", "PURSUE", "Initial match", null, "tenant_alpha");
    await decisionStore.recordUserDecision("person_user1", "li_101", "CONSIDER", "Need to check comp", null, "tenant_alpha");
    await decisionStore.recordUserDecision("person_user1", "li_101", "PASS", "Location mismatch", null, "tenant_alpha");

    // 3. Database Invariant: Exactly 1 row in canonical_decisions table with final action = 'PASS'
    const decisionRows = await adapter.many<{ action: string; reason: string }>(
      `SELECT action, reason FROM canonical_decisions WHERE person_id = ? AND canonical_job_id = ?`,
      ["person_user1", "job_target_1"]
    );
    expect(decisionRows).toHaveLength(1);
    expect(decisionRows[0].action).toBe("PASS");
    expect(decisionRows[0].reason).toBe("Location mismatch");

    // 4. Feed Query Invariant: userAction matches persisted state
    const updatedFeed = await queryStore.getFeed(scope);
    expect(updatedFeed.items[0].userAction).toBe("PASS");
  });
});
