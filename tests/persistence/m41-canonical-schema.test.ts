import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

describe("Phase M4.1: Canonical Schema & Isolation Contracts", () => {
  let sqliteDb: Database.Database;

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

    // Provision base multi-tenant context
    sqliteDb.exec(`INSERT INTO tenants (id, status) VALUES ('tenant_A', 'active'), ('tenant_B', 'active')`);
    sqliteDb.exec(`INSERT INTO people (id, email, tenant_id) VALUES ('person_A', 'a@test.com', 'tenant_A'), ('person_B', 'b@test.com', 'tenant_B')`);
    sqliteDb.exec(`INSERT INTO search_plans (id, tenant_id, person_id, title, criteria_json) VALUES 
      ('plan_A', 'tenant_A', 'person_A', 'A Plan', '{}'),
      ('plan_B', 'tenant_B', 'person_B', 'B Plan', '{}')
    `);
  });

  test("1. Global Canonical Job Identity Uniqueness (source, source_job_id)", () => {
    sqliteDb.exec(`
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name)
      VALUES ('job_hash_123', 'linkedin', '1001', 'http://linkedin.com/1001', 'Acme Corp')
    `);

    const count = sqliteDb.prepare(`SELECT COUNT(*) as c FROM canonical_opportunities`).get() as any;
    expect(count.c).toBe(1);

    expect(() => {
      sqliteDb.exec(`
        INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name)
        VALUES ('job_hash_456', 'linkedin', '1001', 'http://linkedin.com/1001-alt', 'Acme Corp 2')
      `);
    }).toThrow(/UNIQUE constraint failed/);
  });

  test("2. Opportunity Version Uniqueness by (canonical_job_id, content_hash)", () => {
    sqliteDb.exec(`
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url)
      VALUES ('job_1', 'linkedin', '1001', 'http://linkedin.com/1001')
    `);

    sqliteDb.exec(`
      INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content)
      VALUES ('v1_id', 'job_1', 'hash_A', 'Engineer', 'some raw content')
    `);

    expect(() => {
      sqliteDb.exec(`
        INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content)
        VALUES ('v2_id', 'job_1', 'hash_A', 'Engineer', 'same material content')
      `);
    }).toThrow(/UNIQUE constraint failed: opportunity_versions.canonical_job_id, opportunity_versions.content_hash/);

    sqliteDb.exec(`
      INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content)
      VALUES ('v3_id', 'job_1', 'hash_B', 'Senior Engineer', 'changed material content')
    `);
  });

  test("3. SearchPlanCandidate Referential Integrity & Tenant Scoping", () => {
    // Setup Global Job 1 & Version 1
    sqliteDb.exec(`
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url)
      VALUES ('job_1', 'linkedin', '1001', 'http://url')
    `);
    sqliteDb.exec(`
      INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content)
      VALUES ('v1_id', 'job_1', 'hash_A', 'Title', 'Content')
    `);

    // Setup Global Job 2 & Version 2
    sqliteDb.exec(`
      INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url)
      VALUES ('job_2', 'linkedin', '1002', 'http://url2')
    `);
    sqliteDb.exec(`
      INSERT INTO opportunity_versions (id, canonical_job_id, content_hash, job_title, raw_content)
      VALUES ('v2_id', 'job_2', 'hash_B', 'Title 2', 'Content 2')
    `);

    // Valid Projection for Tenant A
    sqliteDb.exec(`
      INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
      VALUES ('tenant_A', 'person_A', 'plan_A', 'job_1', 'v1_id', 'CANDIDATE')
    `);

    // INVALID: Mixing job_1 with v2_id (which belongs to job_2)
    expect(() => {
      sqliteDb.exec(`
        INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
        VALUES ('tenant_A', 'person_A', 'plan_A', 'job_1', 'v2_id', 'CANDIDATE')
      `);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // INVALID: Mixing person_B (belongs to tenant_B) with tenant_A
    expect(() => {
      sqliteDb.exec(`
        INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
        VALUES ('tenant_A', 'person_B', 'plan_A', 'job_1', 'v1_id', 'CANDIDATE')
      `);
    }).toThrow(/FOREIGN KEY constraint failed/);

    // INVALID: Mixing plan_B (belongs to tenant_B, person_B) with tenant_A, person_A
    expect(() => {
      sqliteDb.exec(`
        INSERT INTO search_plan_candidates (tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, attention_decision)
        VALUES ('tenant_A', 'person_A', 'plan_B', 'job_1', 'v1_id', 'CANDIDATE')
      `);
    }).toThrow(/FOREIGN KEY constraint failed/);
  });
});
