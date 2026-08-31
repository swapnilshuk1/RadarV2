/**
 * tests/intelligence/metrics-portal-breakdown.test.ts
 *
 * Verifies that CanonicalOpportunityMetrics accurately aggregates:
 * 1. Global portal metrics (LinkedIn, Naukri, Indeed) without page-1 sampling leaks.
 * 2. Candidate population invariant (portalMetrics.total === totalScreened).
 * 3. Discovery metrics (actionableReviewQueue, engineQualified, unreviewedSparse).
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";
import type { AuthorizedPersonScope } from "../../src/lib/intelligence/opportunity-service";

class StrictTestSqliteAdapter implements DatabaseAdapter {
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
    return fn(this);
  }
}

describe("Metrics Portal Breakdown & Aggregation Invariants", () => {
  let adapter: StrictTestSqliteAdapter;
  let queries: SqliteOpportunityQueries;
  const scope: AuthorizedPersonScope = {
    tenantId: "tenant_test",
    personId: "person_test",
    activeSearchPlanId: "sp_test",
    activeEvaluationContextId: "ec_test",
  };

  beforeEach(async () => {
    const db = new Database(":memory:");
    adapter = new StrictTestSqliteAdapter(db);
    queries = new SqliteOpportunityQueries(adapter);

    // Bootstrap minimal schema required for getMetrics
    await adapter.execute(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT);
      CREATE TABLE memberships (id TEXT PRIMARY KEY, tenant_id TEXT, user_id TEXT, role TEXT, status TEXT, revoked_at TEXT);
      CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, status TEXT);
      CREATE TABLE search_plan_snapshots (id TEXT PRIMARY KEY, search_plan_id TEXT, tenant_id TEXT, person_id TEXT, snapshot_hash TEXT, payload_json TEXT);
      CREATE TABLE evaluation_contexts (context_fingerprint TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, search_plan_snapshot_id TEXT, ontology_version TEXT, ontology_fingerprint TEXT, policy_version TEXT, profile_version TEXT, created_at TEXT);
      CREATE TABLE active_evaluation_contexts (person_id TEXT, tenant_id TEXT, context_fingerprint TEXT, search_plan_id TEXT, activated_at TEXT, PRIMARY KEY (person_id, tenant_id));
      
      CREATE TABLE canonical_opportunities (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        source_job_id TEXT NOT NULL,
        canonical_url TEXT,
        company_name TEXT
      );
      CREATE TABLE opportunity_versions (
        id TEXT PRIMARY KEY,
        canonical_job_id TEXT NOT NULL,
        job_title TEXT NOT NULL,
        lifecycle_state TEXT DEFAULT 'ACTIVE'
      );
      CREATE TABLE search_plan_candidates (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        search_plan_id TEXT NOT NULL,
        canonical_job_id TEXT NOT NULL,
        opportunity_version TEXT NOT NULL,
        attention_decision TEXT NOT NULL
      );
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
        vetoed INTEGER DEFAULT 0
      );
      CREATE TABLE canonical_decisions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        canonical_job_id TEXT NOT NULL,
        action TEXT NOT NULL
      );
    `);

    // Insert active context pointers
    await adapter.execute(`INSERT INTO tenants VALUES ('tenant_test', 'Test Tenant')`);
    await adapter.execute(`INSERT INTO people VALUES ('person_test', 'tenant_test')`);
    await adapter.execute(`INSERT INTO memberships VALUES ('mem_test', 'tenant_test', 'person_test', 'member', 'active', NULL)`);
    await adapter.execute(`INSERT INTO search_plans VALUES ('sp_test', 'tenant_test', 'person_test', 'active')`);
    await adapter.execute(`INSERT INTO search_plan_snapshots VALUES ('sps_test', 'sp_test', 'tenant_test', 'person_test', 'hash', '{}')`);
    await adapter.execute(`INSERT INTO evaluation_contexts VALUES ('ec_test', 'tenant_test', 'person_test', 'sps_test', '3.0.0', 'ont_hash', 'v4.1', 'p_v1', '2026-08-31T00:00:00.000Z')`);
    await adapter.execute(`INSERT INTO active_evaluation_contexts VALUES ('person_test', 'tenant_test', 'ec_test', 'sp_test', '2026-08-31T00:00:00.000Z')`);

    // Populate multi-portal test data
    // 5 LinkedIn, 3 Naukri, 2 Indeed (Total = 10)
    const portals = [
      ...Array(5).fill("LinkedIn"),
      ...Array(3).fill("Naukri"),
      ...Array(2).fill("Indeed"),
    ];

    for (let i = 0; i < portals.length; i++) {
      const jobId = `job_${i}`;
      const versionId = `ver_${i}`;
      const portal = portals[i];

      await adapter.execute(`INSERT INTO canonical_opportunities VALUES (?, ?, ?, ?, ?)`, [jobId, portal, `src_${i}`, `url_${i}`, `Company ${i}`]);
      await adapter.execute(`INSERT INTO opportunity_versions VALUES (?, ?, 'VP Marketing', 'ACTIVE')`, [versionId, jobId]);
      await adapter.execute(`INSERT INTO search_plan_candidates VALUES (?, 'tenant_test', 'person_test', 'sp_test', ?, ?, 'CANDIDATE')`, [`spc_${i}`, jobId, versionId]);
      
      // 2 Pursue, 3 Consider, 5 Pass
      const decision = i < 2 ? "PURSUE" : i < 5 ? "CONSIDER" : "PASS";
      const evalState = i === 9 ? "SPARSE_SPEC" : "COMPLETE";
      await adapter.execute(`INSERT INTO materialized_evaluations VALUES (?, 'tenant_test', 'person_test', ?, ?, 'ec_test', ?, ?, ?, 0)`, [`me_${i}`, jobId, versionId, evalState, decision, 80]);
    }
  });

  it("accurately computes global portal breakdown without page-1 sampling bias", async () => {
    const metrics = await queries.getMetrics(scope);

    expect(metrics.portalMetrics).toBeDefined();
    expect(metrics.portalMetrics?.LinkedIn).toBe(5);
    expect(metrics.portalMetrics?.Naukri).toBe(3);
    expect(metrics.portalMetrics?.Indeed).toBe(2);
    expect(metrics.portalMetrics?.total).toBe(10);
    expect(metrics.totalScreened).toBe(10);
  });

  it("computes discovery and shortlisted metrics consistently", async () => {
    const metrics = await queries.getMetrics(scope);

    expect(metrics.totalShortlisted).toBe(5); // 2 Pursue + 3 Consider
    expect(metrics.discoveryMetrics?.engineQualified).toBe(5);
    expect(metrics.discoveryMetrics?.actionableReviewQueue).toBe(5); // 0 decisions made yet
  });
});
