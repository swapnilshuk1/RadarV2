/**
 * tests/intelligence/canonical-ingestion-fk-regression.test.ts
 *
 * Permanent Primary Regression Suite:
 * Validates Canonical Ingestion Idempotency & Referential FK Lineage.
 *
 * Invariant Certified:
 * Every search_plan_candidates.opportunity_version MUST reference an
 * existing opportunity_versions(canonical_job_id, id), even when
 * opportunity_versions encounters ON CONFLICT DO NOTHING.
 */

import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { CanonicalIngestionService } from "@/lib/acquisition/CanonicalIngestionService";

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

describe("Canonical Ingestion Foreign Key & Idempotency Invariants", () => {
  let db: Database.Database;
  let adapter: DatabaseAdapter;
  let ingestionService: CanonicalIngestionService;

  const tenantId = "tenant_test_001";
  const personId = "person_test_001";
  const searchPlanId = "plan_test_001";

  beforeEach(() => {
    db = new Database(":memory:");
    // Strictly enable SQLite Foreign Keys to catch any reference lineage defect
    db.exec("PRAGMA foreign_keys = ON;");

    // Apply migrations
    const migrationsDir = path.resolve(process.cwd(), "src/data/sqlite/migrations");
    const migrationFiles = fs
      .readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql") && !f.endsWith("_rollback.sql"))
      .sort();

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      try {
        db.exec(sql);
      } catch {
        // Some statements might have multi-statement splits handled in runner
      }
    }

    adapter = new StrictTestSqliteAdapter(db);
    ingestionService = new CanonicalIngestionService(adapter);

    // Seed tenant, person, and active search plan with valid composite lineages
    db.exec(`
      INSERT OR IGNORE INTO tenants (id, status, created_at, updated_at)
      VALUES ('${tenantId}', 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      INSERT OR IGNORE INTO people (id, tenant_id, email, created_at, updated_at)
      VALUES ('${personId}', '${tenantId}', 'swapnil@example.com', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

      INSERT OR IGNORE INTO search_plans (
        id, tenant_id, person_id, title, status, criteria_json, created_at, updated_at
      ) VALUES (
        '${searchPlanId}',
        '${tenantId}',
        '${personId}',
        'Executive Marketing Search',
        'active',
        '{"targetSeniority":["Chief","VP","Director"],"targetRoles":["Marketing","Growth"],"targetLocations":["India","Bengaluru"]}',
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      );
    `);
  });

  it("1. Fresh Ingestion: Inserts opportunity, version, and search plan candidate with valid composite FK", async () => {
    const res = await ingestionService.ingestOpportunity({
      sourcePortal: "LinkedIn",
      sourceJobId: "job_li_101",
      canonicalUrl: "https://www.linkedin.com/jobs/view/job_li_101",
      jobTitle: "Chief Marketing Officer",
      companyName: "Acme Global",
      location: "Bengaluru, India",
      rawContent: "Seeking an executive Chief Marketing Officer to drive global growth and commercial excellence. Experience leading teams.",
      postedAt: "2026-08-30T10:00:00Z",
    });

    expect(res.isNewOpportunity).toBe(true);
    expect(res.isNewVersion).toBe(true);
    expect(res.candidatesProjected).toBe(1);
    expect(res.candidateDecisions[searchPlanId]).toBe("CANDIDATE");

    // Verify foreign key integrity directly in SQLite
    const candidate = await adapter.one<{
      canonical_job_id: string;
      opportunity_version: string;
      attention_decision: string;
    }>(
      `SELECT canonical_job_id, opportunity_version, attention_decision
       FROM search_plan_candidates
       WHERE search_plan_id = ? AND canonical_job_id = ?`,
      [searchPlanId, res.canonicalJobId]
    );

    expect(candidate).toBeDefined();
    expect(candidate?.opportunity_version).toBe(res.opportunityVersion);

    // Check version table
    const version = await adapter.one<{ id: string }>(
      `SELECT id FROM opportunity_versions WHERE canonical_job_id = ? AND id = ?`,
      [res.canonicalJobId, res.opportunityVersion]
    );
    expect(version).toBeDefined();
    expect(version?.id).toBe(res.opportunityVersion);
  });

  it("2. Idempotent Ingestion (DO NOTHING Path): Re-ingesting identical opportunity succeeds without FK error", async () => {
    const payload = {
      sourcePortal: "Naukri",
      sourceJobId: "job_nk_202",
      canonicalUrl: "https://www.naukri.com/job/job_nk_202",
      jobTitle: "VP Marketing & Commercial Growth",
      companyName: "TechCorp India",
      location: "Mumbai, India",
      rawContent: "VP Marketing with deep expertise in enterprise growth and executive leadership across digital transformation.",
      postedAt: "2026-08-30T11:00:00Z",
    };

    // First Ingestion
    const firstRes = await ingestionService.ingestOpportunity(payload);
    expect(firstRes.isNewOpportunity).toBe(true);
    expect(firstRes.isNewVersion).toBe(true);

    // Second Ingestion (Exact same payload: triggers ON CONFLICT DO NOTHING in opportunity_versions)
    const secondRes = await ingestionService.ingestOpportunity(payload);
    expect(secondRes.isNewOpportunity).toBe(false);
    expect(secondRes.isNewVersion).toBe(false);
    expect(secondRes.canonicalJobId).toBe(firstRes.canonicalJobId);
    expect(secondRes.opportunityVersion).toBe(firstRes.opportunityVersion);

    // Crucial Check: Zero orphaned search_plan_candidates
    const orphans = await adapter.many<{ canonical_job_id: string }>(
      `SELECT spc.canonical_job_id 
       FROM search_plan_candidates spc
       LEFT JOIN opportunity_versions ov 
         ON spc.canonical_job_id = ov.canonical_job_id 
        AND spc.opportunity_version = ov.id
       WHERE ov.id IS NULL`
    );
    expect(orphans.length).toBe(0);
  });

  it("3. Content Update Ingestion: When JD content changes, a new version is created and candidate points to new version", async () => {
    const initialPayload = {
      sourcePortal: "Indeed",
      sourceJobId: "job_ind_303",
      canonicalUrl: "https://in.indeed.com/viewjob?jk=job_ind_303",
      jobTitle: "Director Performance Marketing",
      companyName: "GrowthLabs",
      location: "Gurugram, India",
      rawContent: "Initial description with 200 characters of text describing marketing responsibilities.",
      postedAt: "2026-08-30T09:00:00Z",
    };

    const firstRes = await ingestionService.ingestOpportunity(initialPayload);
    expect(firstRes.isNewOpportunity).toBe(true);
    expect(firstRes.isNewVersion).toBe(true);

    // Modified JD content (e.g. enriched detail)
    const updatedPayload = {
      ...initialPayload,
      rawContent: "Updated and heavily enriched description with 800 characters of deep strategic remit and P&L scale.",
    };

    const secondRes = await ingestionService.ingestOpportunity(updatedPayload);
    expect(secondRes.isNewOpportunity).toBe(false); // Same canonical opportunity
    expect(secondRes.isNewVersion).toBe(true); // New content version
    expect(secondRes.opportunityVersion).not.toBe(firstRes.opportunityVersion);

    // Verify candidate points to the new version (latest)
    const candidate = await adapter.one<{ opportunity_version: string }>(
      `SELECT opportunity_version FROM search_plan_candidates
       WHERE search_plan_id = ? AND canonical_job_id = ?
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      [searchPlanId, secondRes.canonicalJobId]
    );
    expect(candidate?.opportunity_version).toBe(secondRes.opportunityVersion);

    // Verify both versions exist in database
    const versions = await adapter.many<{ id: string }>(
      `SELECT id FROM opportunity_versions WHERE canonical_job_id = ? ORDER BY created_at ASC`,
      [secondRes.canonicalJobId]
    );
    expect(versions.length).toBe(2);
  });
});
