import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { CanonicalIngestionService } from "@/lib/acquisition/CanonicalIngestionService";
import { loadSourcePayload, SourcePayloadMissingError } from "@/lib/acquisition/source-payload";
import { MemoryBlobStore } from "@/lib/storage/blob-store";
import type { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { runMigrations, splitSqlStatements } from "@/data/sqlite/migrations/runner";

class TestAdapter implements DatabaseAdapter {
  constructor(readonly db: Database.Database) {}
  async one<T>(sql: string, params?: QueryParams): Promise<T | null> { return (this.db.prepare(sql).get(...(params || [])) as T) || null; }
  async many<T>(sql: string, params?: QueryParams): Promise<T[]> { return this.db.prepare(sql).all(...(params || [])) as T[]; }
  async execute(sql: string, params?: QueryParams) { const result = this.db.prepare(sql).run(...(params || [])); return { rowsAffected: result.changes, lastInsertRowid: result.lastInsertRowid }; }
  async transaction<T>(fn: (tx: DatabaseAdapter) => Promise<T>): Promise<T> { return fn(this); }
}

function schema(db: Database.Database) {
  db.exec(`
    CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT, is_active INTEGER);
    CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, status TEXT, criteria_json TEXT);
    CREATE TABLE canonical_opportunities (id TEXT PRIMARY KEY, source TEXT, source_job_id TEXT, canonical_url TEXT, company_name TEXT, created_at TEXT, last_seen_at TEXT, UNIQUE(source, source_job_id));
    CREATE TABLE opportunity_versions (
      id TEXT PRIMARY KEY, canonical_job_id TEXT, content_hash TEXT, job_title TEXT, company_name TEXT, location TEXT,
      employment_type TEXT, posted_at TEXT, posted_precision TEXT, raw_content TEXT NOT NULL, acquisition_status TEXT,
      acquisition_quality TEXT, failure_class TEXT, lifecycle_state TEXT, evidence_state TEXT, created_at TEXT,
      source_payload_key TEXT, source_media_type TEXT, document_extraction_state TEXT,
      UNIQUE(canonical_job_id, content_hash)
    );
    CREATE TABLE search_plan_candidates (tenant_id TEXT, person_id TEXT, search_plan_id TEXT, canonical_job_id TEXT, opportunity_version TEXT, attention_decision TEXT, created_at TEXT);
    CREATE TABLE recovery_queue (id TEXT PRIMARY KEY, tenant_id TEXT, canonical_job_id TEXT, opportunity_version_id TEXT, source TEXT, canonical_url TEXT, reason TEXT, failure_class TEXT, attempt_count INTEGER, status TEXT, next_attempt_at TEXT, created_at TEXT);
  `);
}

describe("C4a source-payload provenance migration", () => {
  it("is additive, nullable for existing text records, and contains no backfill", () => {
    const migration = readFileSync("src/data/sqlite/migrations/033_opportunity_version_source_payload.sql", "utf8");
    expect(migration).not.toMatch(/\bUPDATE\b|\bDELETE\b|\bINSERT\b/i);
    const db = new Database(":memory:");
    db.exec("CREATE TABLE opportunity_versions (id TEXT PRIMARY KEY, raw_content TEXT NOT NULL)");
    db.exec("INSERT INTO opportunity_versions (id, raw_content) VALUES ('existing_html', 'existing readable JD')");
    for (const statement of splitSqlStatements(migration)) db.exec(statement);
    const row = db.prepare("SELECT raw_content, source_payload_key, source_media_type, document_extraction_state FROM opportunity_versions WHERE id = 'existing_html'").get() as any;
    expect(row).toEqual({ raw_content: "existing readable JD", source_payload_key: null, source_media_type: null, document_extraction_state: null });
  });

  it("is applied once by the migration runner and skipped idempotently thereafter", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "radar-migration-033-"));
    try {
      copyFileSync("src/data/sqlite/migrations/033_opportunity_version_source_payload.sql", path.join(directory, "033_opportunity_version_source_payload.sql"));
      const db = new Database(":memory:");
      db.exec("CREATE TABLE opportunity_versions (id TEXT PRIMARY KEY, raw_content TEXT NOT NULL)");
      const adapter = new TestAdapter(db);
      const first = await runMigrations(adapter, directory);
      const second = await runMigrations(adapter, directory);
      expect(first.applied).toEqual(["033_opportunity_version_source_payload.sql"]);
      expect(second.skipped).toEqual(["033_opportunity_version_source_payload.sql"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("persists a PDF only through an explicit BlobStore reference and keeps raw_content empty", async () => {
    const db = new Database(":memory:"); schema(db);
    const blobStore = new MemoryBlobStore();
    const service = new CanonicalIngestionService(new TestAdapter(db), blobStore);
    const bytes = "%PDF-1.7\nsource bytes, not extracted text";
    const first = await service.ingestOpportunity({
      sourcePortal: "Naukri", sourceJobId: "pdf-1", canonicalUrl: "https://example.com/job/pdf-1",
      jobTitle: "Vice President Sales", companyName: "Fillezy", location: "Gurugram", rawContent: bytes,
      sourcePayload: bytes, contentType: "application/pdf",
    });
    const row = db.prepare("SELECT raw_content, source_payload_key, source_media_type, document_extraction_state FROM opportunity_versions WHERE id = ?").get(first.opportunityVersion) as any;
    expect(row.raw_content).toBe("");
    expect(row.source_payload_key).toBeTruthy();
    expect(row.source_media_type).toBe("application/pdf");
    expect(row.document_extraction_state).toBe("PENDING");
    await expect(loadSourcePayload(blobStore, row.source_payload_key)).resolves.toEqual(Buffer.from(bytes));
    const replay = await service.ingestOpportunity({
      sourcePortal: "Naukri", sourceJobId: "pdf-1", canonicalUrl: "https://example.com/job/pdf-1",
      jobTitle: "Vice President Sales", companyName: "Fillezy", location: "Gurugram", rawContent: bytes,
      sourcePayload: bytes, contentType: "application/pdf",
    });
    expect(replay.opportunityVersion).toBe(first.opportunityVersion);
  });

  it("fails closed when a persisted source-payload reference cannot be resolved", async () => {
    await expect(loadSourcePayload(new MemoryBlobStore(), "opportunity-versions/missing/source"))
      .rejects.toBeInstanceOf(SourcePayloadMissingError);
    await expect(loadSourcePayload(new MemoryBlobStore(), null))
      .rejects.toBeInstanceOf(SourcePayloadMissingError);
  });
});
