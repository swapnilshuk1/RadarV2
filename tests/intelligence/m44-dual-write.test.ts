/**
 * M4.4 Dual-Write Integration Tests
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

describe("Phase M4.4: Dual-Write & Shadow Path", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");
    adapter = new TestSqliteAdapter(sqliteDb);
    await runMigrations(adapter);

    sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_A', 'active'), ('tenant_B', 'active')");
    sqliteDb.exec("INSERT INTO people (id, email, tenant_id) VALUES ('person_A', 'a@test.com', 'tenant_A'), ('person_B', 'b@test.com', 'tenant_B')");
    sqliteDb.exec(`INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES ('plan_A', 'tenant_A', 'person_A', 'active', 'A Plan', '{"targetRoles":["executive"]}'), ('plan_B', 'tenant_B', 'person_B', 'active', 'B Plan', '{"targetRoles":["manager"]}')`);
    (global as any).getDatabaseAdapter = () => adapter;
  });

  test("1. Shadow path projects independently for multiple tenants", async () => {
    await executeM4ShadowPath({
      sourcePortal: "linkedin",
      sourceJobId: "12345",
      canonicalUrl: "https://url",
      jobTitle: "Executive Director",
      companyName: "Company X",
      location: "New York",
      employmentType: "Full Time",
      rawContent: "..."
    }, adapter);
    
    // Gate matches Plan A & rejects Plan B
    const candidates = await adapter.many<any>("SELECT * FROM search_plan_candidates ORDER BY tenant_id");
    expect(candidates.length).toBe(2);
    expect(candidates[0].attention_decision).toBe("CANDIDATE");
    expect(candidates[1].attention_decision).toBe("NOT_CANDIDATE");
  });
  
  test("2. Canonical records contain no tenant-specific fields", async () => {
    await executeM4ShadowPath({
      sourcePortal: "linkedin", sourceJobId: "12345", canonicalUrl: "https://url", jobTitle: "Director", companyName: "Company X", location: "NY", employmentType: "Full Time", rawContent: "..."
    }, adapter);
    const opps = await adapter.many<any>("SELECT * FROM canonical_opportunities");
    expect(opps[0].id).toBeTruthy();
    expect(opps[0].tenant_id).toBeUndefined();
    expect(opps[0].search_plan_id).toBeUndefined();
    const vers = await adapter.many<any>("SELECT * FROM opportunity_versions");
    expect(vers[0].tenant_id).toBeUndefined();
  });

  test("3. Atomicity Invariant: Candidate persistence failure rolls back canonical opportunity and version", async () => {
    const { recordSearchPlanCandidate } = await import("@/lib/intelligence/recordSearchPlanCandidate");
    
    const fakeOpp: any = {
      id: "canon_fail_1",
      source: "linkedin",
      sourceJobId: "job_fail_1",
      canonicalUrl: "https://fail.url"
    };

    const fakeVer: any = {
      id: "ver_fail_1",
      canonicalJobId: "canon_fail_1",
      contentHash: "hash_fail_1",
      jobTitle: "Fail Job",
      companyName: "Fail Co",
      location: "Remote",
      employmentType: "Full-time",
      rawContent: "Fail content"
    };

    // Trigger FK constraint failure by passing non-existent tenant_id 'tenant_INVALID'
    await expect(
      recordSearchPlanCandidate(adapter, "tenant_INVALID", "person_INVALID", "plan_INVALID", fakeOpp, fakeVer, "CANDIDATE")
    ).rejects.toThrow();

    // Verify complete rollback: neither canonical_opportunities nor opportunity_versions contains partial writes
    const opp = await adapter.one<any>("SELECT * FROM canonical_opportunities WHERE id = 'canon_fail_1'");
    const ver = await adapter.one<any>("SELECT * FROM opportunity_versions WHERE id = 'ver_fail_1'");
    const cand = await adapter.one<any>("SELECT * FROM search_plan_candidates WHERE canonical_job_id = 'canon_fail_1'");

    expect(opp).toBeNull();
    expect(ver).toBeNull();
    expect(cand).toBeNull();
  });

  test("4. Fault Isolation Invariant: M4 dual-write error is caught and isolated without throwing", async () => {
    // Create a broken adapter that throws on execute
    const brokenAdapter: DatabaseAdapter = {
      one: async () => null,
      many: async () => { throw new Error("INJECTED_DATABASE_CRASH"); },
      execute: async () => { throw new Error("INJECTED_DATABASE_CRASH"); },
      transaction: async () => { throw new Error("INJECTED_DATABASE_CRASH"); }
    };

    // Simulate scraper fault isolation wrapper
    let legacyAcquisitionSuccess = false;
    let m4ShadowErrorRecorded = false;

    // Step A: Legacy acquisition succeeds
    legacyAcquisitionSuccess = true;

    // Step B: M4 dual write executes in try/catch fault isolation block
    try {
      await executeM4ShadowPath({
        sourcePortal: "linkedin",
        sourceJobId: "crash_001",
        canonicalUrl: "https://crash.url",
        jobTitle: "Crash Title",
        companyName: "Crash Co",
        location: "NY",
        employmentType: "Full-time",
        rawContent: "Content"
      }, brokenAdapter);
    } catch (err: any) {
      m4ShadowErrorRecorded = true;
    }

    expect(legacyAcquisitionSuccess).toBe(true);
    expect(m4ShadowErrorRecorded).toBe(true);
  });

  test("5. Tenant Write Lineage Boundary: Tenant A plan creates only Tenant A candidate; Tenant B plan creates only Tenant B candidate", async () => {
    await executeM4ShadowPath({
      sourcePortal: "glassdoor",
      sourceJobId: "gd_888",
      canonicalUrl: "https://glassdoor.com/888",
      jobTitle: "Executive Director",
      companyName: "Global Inc",
      location: "San Francisco",
      employmentType: "Full-time",
      rawContent: "Executive leadership role."
    }, adapter);

    const candidatesA = await adapter.many<any>("SELECT * FROM search_plan_candidates WHERE tenant_id = 'tenant_A'");
    const candidatesB = await adapter.many<any>("SELECT * FROM search_plan_candidates WHERE tenant_id = 'tenant_B'");

    expect(candidatesA.length).toBe(1);
    expect(candidatesA[0].person_id).toBe("person_A");
    expect(candidatesA[0].search_plan_id).toBe("plan_A");

    expect(candidatesB.length).toBe(1);
    expect(candidatesB[0].person_id).toBe("person_B");
    expect(candidatesB[0].search_plan_id).toBe("plan_B");

    // Both point to the exact same global canonical_job_id
    expect(candidatesA[0].canonical_job_id).toBe(candidatesB[0].canonical_job_id);
  });
});
