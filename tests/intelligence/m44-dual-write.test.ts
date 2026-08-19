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
    return fn(this);
  }
}

describe("Phase M4.4: Dual-Write & Shadow Path", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;

  beforeEach(() => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");
    const migrationFiles = [
      "001_initial_schema.sql",
      "009_profile_queryable_columns.sql",
      "018_multi_tenant_foundation.sql",
      "019_evaluation_context_and_read_model.sql",
      "020_canonical_acquisition.sql"
    ];
    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }
    sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_A', 'active'), ('tenant_B', 'active')");
    sqliteDb.exec("INSERT INTO people (id, email, tenant_id) VALUES ('person_A', 'a@test.com', 'tenant_A'), ('person_B', 'b@test.com', 'tenant_B')");
    sqliteDb.exec(`INSERT INTO search_plans (id, tenant_id, person_id, status, title, criteria_json) VALUES ('plan_A', 'tenant_A', 'person_A', 'active', 'A Plan', '{"targetRoles":["executive"]}'), ('plan_B', 'tenant_B', 'person_B', 'active', 'B Plan', '{"targetRoles":["manager"]}')`);
    adapter = new TestSqliteAdapter(sqliteDb);
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
});
