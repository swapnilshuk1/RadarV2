import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { SqliteAcquisitionStore } from "@/data/sqlite/repositories/SqliteAcquisitionStore";

class TestAdapter implements DatabaseAdapter {
  constructor(readonly db: Database.Database) {}

  async one<T>(sql: string, params?: QueryParams): Promise<T | null> {
    return (this.db.prepare(sql).get(...(params || [])) as T) || null;
  }

  async many<T>(sql: string, params?: QueryParams): Promise<T[]> {
    return this.db.prepare(sql).all(...(params || [])) as T[];
  }

  async execute(sql: string, params?: QueryParams) {
    const result = this.db.prepare(sql).run(...(params || []));
    return { rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> {
    this.db.exec("BEGIN");
    try {
      const result = await fn(this);
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function createSchema(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE tenants (id TEXT PRIMARY KEY);
    CREATE TABLE people (id TEXT NOT NULL, tenant_id TEXT NOT NULL, UNIQUE(id, tenant_id));
    CREATE TABLE scrape_runs (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL);
    CREATE TABLE acquisition_ledger (id TEXT PRIMARY KEY);
    CREATE TABLE canonical_opportunities (id TEXT PRIMARY KEY);
    CREATE TABLE opportunity_versions (
      id TEXT PRIMARY KEY,
      canonical_job_id TEXT NOT NULL,
      UNIQUE(canonical_job_id, id)
    );
  `);
  db.exec(readFileSync("src/data/sqlite/migrations/034_acquisition_ingestion_lineage.sql", "utf8"));
  db.exec(readFileSync("src/data/sqlite/migrations/041_indeed_resolution_provenance.sql", "utf8"));
  db.prepare("INSERT INTO tenants (id) VALUES ('tenant-a')").run();
  db.prepare("INSERT INTO people (id, tenant_id) VALUES ('person-a', 'tenant-a')").run();
  db.prepare("INSERT INTO scrape_runs (id, tenant_id, person_id) VALUES ('run-a', 'tenant-a', 'person-a')").run();
  db.prepare("INSERT INTO acquisition_ledger (id) VALUES ('ledger-a')").run();
  db.prepare("INSERT INTO canonical_opportunities (id) VALUES ('job-a')").run();
  db.prepare("INSERT INTO opportunity_versions (id, canonical_job_id) VALUES ('version-a', 'job-a')").run();
}

describe("acquisition ingestion lineage", () => {
  it("persists the exact canonical job/version returned by ingestion and is idempotent for a retry", async () => {
    const sqlite = new Database(":memory:");
    createSchema(sqlite);
    const store = new SqliteAcquisitionStore(new TestAdapter(sqlite));
    const event = {
      scrapeRunId: "run-a",
      tenantId: "tenant-a",
      personId: "person-a",
      acquisitionLedgerId: "ledger-a",
      cardId: "linkedin:unit-1#card-1",
      ingestionAttempt: 1,
      sourcePortal: "LinkedIn",
      sourceJobId: "linkedin-job-1",
      sourceUrl: "https://www.linkedin.com/jobs/view/1",
      resolvedUrl: "https://www.linkedin.com/jobs/view/1",
      captureState: "SUCCEEDED",
      documentState: "SUBSTANTIVE",
      contentHash: "content-hash-a",
      canonicalJobId: "job-a",
      opportunityVersion: "version-a",
    };

    const first = await store.recordIngestionLineage(event);
    const replay = await store.recordIngestionLineage(event);

    expect(replay.id).toBe(first.id);
    await expect(store.listIngestionLineageForRun("tenant-a", "person-a", "run-a"))
      .resolves.toMatchObject([{ ...event, id: first.id }]);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM acquisition_ingestion_lineage").get())
      .toEqual({ count: 1 });
  });

  it("preserves the discovery URL and exact resolved listing URL as separate provenance", async () => {
    const sqlite = new Database(":memory:");
    createSchema(sqlite);
    const store = new SqliteAcquisitionStore(new TestAdapter(sqlite));
    const lineage = await store.recordIngestionLineage({
      scrapeRunId: "run-a", tenantId: "tenant-a", personId: "person-a", acquisitionLedgerId: "ledger-a",
      cardId: "indeed:unit-1#card-sponsored", ingestionAttempt: 1, sourcePortal: "Indeed", sourceJobId: "abc123",
      sourceUrl: "https://in.indeed.com/pagead/clk?tracking=opaque",
      resolvedUrl: "https://in.indeed.com/viewjob?jk=ABC123&source=pagead",
      captureState: "SUCCEEDED", documentState: "SUBSTANTIVE", contentHash: "hash-abc123", canonicalJobId: "job-a", opportunityVersion: "version-a",
    });
    expect(lineage.sourceUrl).toContain("pagead/clk");
    expect(lineage.resolvedUrl).toContain("viewjob?jk=ABC123");
  });

  it("retains a failed acquisition attempt without inventing canonical identity", async () => {
    const sqlite = new Database(":memory:");
    createSchema(sqlite);
    const store = new SqliteAcquisitionStore(new TestAdapter(sqlite));

    const recorded = await store.recordIngestionLineage({
      scrapeRunId: "run-a",
      tenantId: "tenant-a",
      personId: "person-a",
      acquisitionLedgerId: "ledger-a",
      cardId: "indeed:unit-1#card-404",
      ingestionAttempt: 1,
      sourcePortal: "Indeed",
      sourceJobId: "indeed-job-404",
      sourceUrl: "https://www.indeed.com/viewjob?jk=404",
      captureState: "FAILED",
      documentState: "UNUSABLE",
      failureClass: "REMOVED_404",
    });

    expect(recorded.canonicalJobId).toBeUndefined();
    expect(recorded.opportunityVersion).toBeUndefined();
    expect(recorded.failureClass).toBe("REMOVED_404");
  });

  it("rejects conflicting replay identity and a run outside the supplied tenant/person scope", async () => {
    const sqlite = new Database(":memory:");
    createSchema(sqlite);
    const store = new SqliteAcquisitionStore(new TestAdapter(sqlite));
    const event = {
      scrapeRunId: "run-a",
      tenantId: "tenant-a",
      personId: "person-a",
      acquisitionLedgerId: "ledger-a",
      cardId: "naukri:unit-1#card-1",
      ingestionAttempt: 1,
      sourcePortal: "Naukri",
      sourceJobId: "naukri-job-1",
      sourceUrl: "https://www.naukri.com/job-listings-1",
      captureState: "SUCCEEDED",
      documentState: "SUBSTANTIVE",
      contentHash: "content-hash-a",
      canonicalJobId: "job-a",
      opportunityVersion: "version-a",
    };
    await store.recordIngestionLineage(event);

    await expect(store.recordIngestionLineage({ ...event, sourceUrl: "https://www.naukri.com/job-listings-other" }))
      .rejects.toThrow("conflicting provenance");
    await expect(store.recordIngestionLineage({
      ...event,
      cardId: "naukri:unit-1#card-2",
      tenantId: "tenant-other",
    })).rejects.toThrow("does not belong to the supplied tenant/person scope");
  });
});
