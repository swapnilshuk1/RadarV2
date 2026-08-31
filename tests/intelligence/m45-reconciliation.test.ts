/**
 * M4.5 Operational Reconciliation Integration & Invariant Tests
 */
import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { executeM4ShadowPath } from "@/lib/intelligence/dualWrite";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";

class TestSqliteAdapter implements DatabaseAdapter {
  constructor(private db: Database.Database) {}
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

describe("Phase M4.5: Operational Reconciliation & Acquisition Audit", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");
    adapter = new TestSqliteAdapter(sqliteDb);
    await runMigrations(adapter);

    sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_1', 'active')");
    sqliteDb.exec("INSERT INTO people (id, email, tenant_id) VALUES ('person_1', 'exec@test.com', 'tenant_1')");
    sqliteDb.exec(`INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES 
      ('plan_1', 'tenant_1', 'person_1', 'active', 'VP Product', '{"targetRoles":["VP Product","Chief Product Officer"]}'),
      ('plan_2', 'tenant_1', 'person_1', 'active', 'Engineering', '{"targetRoles":["VP Engineering"]}')
    `);
  });

  test("1. Dual-write ingestion produces 100% reconciled canonical jobs, versions, and candidate projections", async () => {
    // Ingest Job 1: VP Product
    await executeM4ShadowPath({
      sourcePortal: "linkedin",
      sourceJobId: "job-prod-001",
      canonicalUrl: "https://linkedin.com/jobs/001",
      jobTitle: "VP Product",
      companyName: "Acme Corp",
      location: "San Francisco, CA",
      employmentType: "Full-time",
      rawContent: "VP Product role at Acme Corp leading executive initiatives."
    }, adapter);

    // Ingest Job 2: VP Engineering
    await executeM4ShadowPath({
      sourcePortal: "naukri",
      sourceJobId: "job-eng-002",
      canonicalUrl: "https://naukri.com/jobs/002",
      jobTitle: "VP Engineering",
      companyName: "Beta Labs",
      location: "Bengaluru, India",
      employmentType: "Full-time",
      rawContent: "VP Engineering role heading cloud architecture."
    }, adapter);

    const canonicalCount = await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM canonical_opportunities");
    const versionCount = await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunity_versions");
    const candidateCount = await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM search_plan_candidates");

    expect(canonicalCount?.count).toBe(2);
    expect(versionCount?.count).toBe(2);
    // 2 jobs x 2 search plans = 4 total projections
    expect(candidateCount?.count).toBe(4);

    // Verify candidate decisions
    const p1c1 = await adapter.one<any>("SELECT attention_decision FROM search_plan_candidates WHERE search_plan_id = 'plan_1' AND canonical_job_id = (SELECT id FROM canonical_opportunities WHERE source_job_id = 'job-prod-001')");
    expect(p1c1.attention_decision).toBe("CANDIDATE");

    const p2c1 = await adapter.one<any>("SELECT attention_decision FROM search_plan_candidates WHERE search_plan_id = 'plan_2' AND canonical_job_id = (SELECT id FROM canonical_opportunities WHERE source_job_id = 'job-prod-001')");
    expect(p2c1.attention_decision).toBe("NOT_CANDIDATE");
  });

  test("2. Re-ingesting identical content does not create spurious versions or duplicate candidates", async () => {
    const payload = {
      sourcePortal: "greenhouse",
      sourceJobId: "gh-101",
      canonicalUrl: "https://boards.greenhouse.io/gh/101",
      jobTitle: "Chief Product Officer",
      companyName: "Gamma SaaS",
      location: "Remote",
      employmentType: "Full-time",
      rawContent: "Leading product strategy."
    };

    // First ingestion
    await executeM4ShadowPath(payload, adapter);
    // Duplicate ingestion with same content
    await executeM4ShadowPath(payload, adapter);

    const canonicalCount = await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM canonical_opportunities");
    const versionCount = await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunity_versions");
    const candidateCount = await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM search_plan_candidates");

    expect(canonicalCount?.count).toBe(1);
    expect(versionCount?.count).toBe(1);
    expect(candidateCount?.count).toBe(2); // 2 search plans
  });

  test("3. Material change detection creates a second version while keeping canonical job singular", async () => {
    const payloadV1 = {
      sourcePortal: "greenhouse",
      sourceJobId: "gh-202",
      canonicalUrl: "https://boards.greenhouse.io/gh/202",
      jobTitle: "VP Engineering",
      companyName: "Delta Corp",
      location: "New York, NY",
      employmentType: "Full-time",
      rawContent: "Initial description"
    };

    const payloadV2 = {
      ...payloadV1,
      rawContent: "Updated description with new P&L responsibilities."
    };

    await executeM4ShadowPath(payloadV1, adapter);
    await executeM4ShadowPath(payloadV2, adapter);

    const canonicalCount = await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM canonical_opportunities");
    const versionCount = await adapter.one<{ count: number }>("SELECT COUNT(*) as count FROM opportunity_versions");

    expect(canonicalCount?.count).toBe(1);
    expect(versionCount?.count).toBe(2);
  });

  test("4. Audit reconciliation proves zero orphans across canonical, version, and candidate tables", async () => {
    await executeM4ShadowPath({
      sourcePortal: "workday",
      sourceJobId: "wd-999",
      canonicalUrl: "https://workday.com/jobs/999",
      jobTitle: "VP Product",
      companyName: "Enterprise Inc",
      location: "Austin, TX",
      employmentType: "Full-time",
      rawContent: "Enterprise product leadership."
    }, adapter);

    // Check for orphaned canonical jobs (no version)
    const orphanedJobs = await adapter.one<{ count: number }>(`
      SELECT COUNT(*) as count 
      FROM canonical_opportunities c 
      LEFT JOIN opportunity_versions v ON c.id = v.canonical_job_id 
      WHERE v.id IS NULL
    `);
    expect(orphanedJobs?.count).toBe(0);

    // Check for orphaned candidates using composite (job_id, version_id) relationship
    const orphanedCandidates = await adapter.one<{ count: number }>(`
      SELECT COUNT(*) as count 
      FROM search_plan_candidates c 
      LEFT JOIN opportunity_versions v 
        ON v.canonical_job_id = c.canonical_job_id 
       AND v.id = c.opportunity_version 
      WHERE v.id IS NULL
    `);
    expect(orphanedCandidates?.count).toBe(0);
  });

  test("5. Employment type null preservation invariant test", async () => {
    await executeM4ShadowPath({
      sourcePortal: "lever",
      sourceJobId: "lev-555",
      canonicalUrl: "https://jobs.lever.co/lev/555",
      jobTitle: "VP Marketing",
      companyName: "Growth Co",
      location: "Remote",
      employmentType: null,
      rawContent: "Executive VP Marketing role."
    }, adapter);

    const ver = await adapter.one<any>("SELECT employment_type FROM opportunity_versions WHERE job_title = 'VP Marketing'");
    expect(ver.employment_type).toBeNull();
  });
});
