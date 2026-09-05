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

  it("preserves the sponsored discovery URL while rebinding lineage to the verified Indeed listing identity", async () => {
    const sqlite = new Database(":memory:");
    createSchema(sqlite);
    const store = new SqliteAcquisitionStore(new TestAdapter(sqlite));
    sqlite.exec(`ALTER TABLE acquisition_ledger ADD COLUMN canonical_job_id TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN source_portal TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN source_job_id TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN canonical_url TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN state TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN terminal_state TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN updated_at TEXT;`);
    sqlite.prepare(`UPDATE acquisition_ledger
                       SET canonical_job_id = ?, source_portal = ?, source_job_id = ?, canonical_url = ?, state = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`)
      .run("indeed:url_provisional", "Indeed", "provisional", "https://in.indeed.com/pagead/clk?ad=opaque", "QUEUED", "ledger-a");

    const ledger = await store.rebindDiscoveredJobIdentity("ledger-a", {
      canonicalJobId: "indeed:jk_abc123",
      sourcePortal: "Indeed",
      sourceJobId: "abc123",
      canonicalUrl: "https://in.indeed.com/viewjob?jk=abc123",
    });
    expect(ledger.canonicalJobId).toBe("indeed:jk_abc123");
    expect(ledger.canonicalUrl).toBe("https://in.indeed.com/viewjob?jk=abc123");

    const recorded = await store.recordIngestionLineage({
      scrapeRunId: "run-a",
      tenantId: "tenant-a",
      personId: "person-a",
      acquisitionLedgerId: ledger.id,
      cardId: "indeed:unit-1#sponsored",
      ingestionAttempt: 1,
      sourcePortal: "Indeed",
      sourceJobId: "abc123",
      sourceUrl: "https://in.indeed.com/pagead/clk?ad=opaque",
      captureState: "CAPTURED",
      documentState: "SUBSTANTIVE",
      contentHash: "content-hash-a",
      canonicalJobId: "job-a",
      opportunityVersion: "version-a",
    });
    expect(recorded.sourceUrl).toBe("https://in.indeed.com/pagead/clk?ad=opaque");
    expect(recorded.sourceJobId).toBe("abc123");
  });

  it("keeps one verified Indeed identity while retaining repeated discovery observations", async () => {
    const sqlite = new Database(":memory:");
    createSchema(sqlite);
    const store = new SqliteAcquisitionStore(new TestAdapter(sqlite));
    sqlite.exec(`ALTER TABLE acquisition_ledger ADD COLUMN canonical_job_id TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN source_portal TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN source_job_id TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN canonical_url TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN state TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN terminal_state TEXT;
                 ALTER TABLE acquisition_ledger ADD COLUMN updated_at TEXT;`);
    sqlite.prepare("INSERT INTO acquisition_ledger (id) VALUES ('ledger-b')").run();
    const provision = sqlite.prepare(`UPDATE acquisition_ledger
      SET canonical_job_id = ?, source_portal = ?, source_job_id = ?, canonical_url = ?, state = ?
      WHERE id = ?`);
    provision.run("indeed:url_first", "Indeed", "first", "https://in.indeed.com/pagead/clk?ad=first", "QUEUED", "ledger-a");
    provision.run("indeed:url_repeat", "Indeed", "repeat", "https://in.indeed.com/pagead/clk?ad=repeat", "QUEUED", "ledger-b");

    const identity = {
      canonicalJobId: "indeed:jk_abc123",
      sourcePortal: "Indeed" as const,
      sourceJobId: "abc123",
      canonicalUrl: "https://in.indeed.com/viewjob?jk=abc123",
    };
    const first = await store.rebindDiscoveredJobIdentity("ledger-a", identity);
    const repeated = await store.rebindDiscoveredJobIdentity("ledger-b", identity);

    expect(repeated.id).toBe(first.id);
    expect(sqlite.prepare("SELECT state, terminal_state FROM acquisition_ledger WHERE id = 'ledger-b'").get())
      .toEqual({ state: "IDENTITY_RESOLVED", terminal_state: "SUPERSEDED_BY_VERIFIED_IDENTITY" });

    await store.recordIngestionLineage({
      scrapeRunId: "run-a", tenantId: "tenant-a", personId: "person-a", acquisitionLedgerId: first.id,
      cardId: "indeed:unit-1#first", ingestionAttempt: 1, sourcePortal: "Indeed", sourceJobId: "abc123",
      sourceUrl: "https://in.indeed.com/pagead/clk?ad=first", captureState: "CAPTURED", documentState: "SUBSTANTIVE",
      contentHash: "content-hash-a", canonicalJobId: "job-a", opportunityVersion: "version-a",
    });
    await store.recordIngestionLineage({
      scrapeRunId: "run-a", tenantId: "tenant-a", personId: "person-a", acquisitionLedgerId: repeated.id,
      cardId: "indeed:unit-1#repeat", ingestionAttempt: 1, sourcePortal: "Indeed", sourceJobId: "abc123",
      sourceUrl: "https://in.indeed.com/pagead/clk?ad=repeat", captureState: "CAPTURED", documentState: "SUBSTANTIVE",
      contentHash: "content-hash-a", canonicalJobId: "job-a", opportunityVersion: "version-a",
    });

    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM acquisition_ingestion_lineage WHERE source_job_id = 'abc123'").get())
      .toEqual({ count: 2 });
  });
});
