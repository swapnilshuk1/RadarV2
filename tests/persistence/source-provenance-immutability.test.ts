import crypto from "crypto";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DatabaseAdapter, QueryParams } from "@/data/database/adapter";
import { SqliteDocumentStore } from "@/data/sqlite/repositories/SqliteDocumentStore";
import { splitSqlStatements } from "@/data/sqlite/migrations/runner";
import { CanonicalIngestionService } from "@/lib/acquisition/CanonicalIngestionService";
import { MemoryBlobStore } from "@/lib/storage/blob-store";
import {
  SourceSnapshotIdentityMismatchError,
  SourceSnapshotResolver,
  SourceSnapshotUnavailableError,
} from "@/lib/provenance/SourceSnapshotResolver";

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
    return fn(this);
  }
}

function createSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE candidate_documents (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      storage_uri TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      document_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      stage TEXT NOT NULL,
      error_message TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE document_contents (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL UNIQUE,
      raw_text TEXT NOT NULL,
      text_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE canonical_opportunities (
      id TEXT PRIMARY KEY,
      source TEXT,
      source_job_id TEXT,
      canonical_url TEXT,
      company_name TEXT,
      created_at TEXT,
      last_seen_at TEXT,
      UNIQUE(source, source_job_id)
    );
    CREATE TABLE opportunity_versions (
      id TEXT PRIMARY KEY,
      canonical_job_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      job_title TEXT NOT NULL,
      company_name TEXT,
      location TEXT,
      employment_type TEXT,
      posted_at TEXT,
      posted_precision TEXT,
      raw_content TEXT NOT NULL,
      category_ids TEXT,
      acquisition_status TEXT,
      acquisition_quality TEXT,
      failure_class TEXT,
      lifecycle_state TEXT,
      evidence_state TEXT,
      source_payload_key TEXT,
      source_media_type TEXT,
      document_extraction_state TEXT,
      created_at TEXT,
      UNIQUE(canonical_job_id, content_hash)
    );
    CREATE TABLE tenants (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT, is_active INTEGER);
    CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, status TEXT, criteria_json TEXT);
    CREATE TABLE search_plan_candidates (
      tenant_id TEXT,
      person_id TEXT,
      search_plan_id TEXT,
      canonical_job_id TEXT,
      opportunity_version TEXT,
      attention_decision TEXT,
      created_at TEXT
    );
    CREATE TABLE recovery_queue (
      id TEXT PRIMARY KEY,
      tenant_id TEXT,
      canonical_job_id TEXT,
      opportunity_version_id TEXT,
      source TEXT,
      canonical_url TEXT,
      reason TEXT,
      failure_class TEXT,
      attempt_count INTEGER,
      status TEXT,
      next_attempt_at TEXT,
      created_at TEXT
    );
  `);
}

function applySourceImmutabilityMigration(db: Database.Database) {
  const migration = readFileSync(
    "src/data/sqlite/migrations/047_source_provenance_immutability.sql",
    "utf8",
  );
  for (const statement of splitSqlStatements(migration)) {
    db.exec(statement);
  }
}

function documentRecord(id: string, hash: string) {
  const now = "2026-09-13T00:00:00.000Z";
  return {
    id,
    personId: "person-1",
    filename: `${id}.pdf`,
    storageUri: `blob://${id}`,
    mimeType: "application/pdf",
    documentHash: hash,
    status: "COMPLETED" as const,
    stage: "EXTRACTED",
    createdAt: now,
    updatedAt: now,
  };
}

function pdfPayload(sourceJobId: string, sourcePayload: string) {
  return {
    sourcePortal: "Naukri",
    sourceJobId,
    canonicalUrl: `https://example.com/job/${sourceJobId}`,
    jobTitle: "Vice President Sales",
    companyName: "Acme",
    location: "Gurugram",
    rawContent: "%PDF-1.7 canonical identity material",
    sourcePayload,
    contentType: "application/pdf",
  };
}

describe("Gate 1B source/provenance immutability", () => {
  it("keeps candidate document text lifetime-resolvable after later uploads and rejects same-identity rewrites", async () => {
    const rawDb = new Database(":memory:");
    createSchema(rawDb);
    applySourceImmutabilityMigration(rawDb);
    const db = new TestAdapter(rawDb);
    const store = new SqliteDocumentStore(db);
    const resolver = new SourceSnapshotResolver(db);

    await store.saveDocument(documentRecord("doc-1", "document-hash-1"));
    await store.saveDocumentContent("doc-1", "first immutable candidate source", "text-hash-1");
    const ref = await resolver.captureCandidateDocumentRef("person-1", "doc-1");

    await expect(
      store.saveDocumentContent("doc-1", "first immutable candidate source", "text-hash-1"),
    ).resolves.toBeUndefined();
    await expect(
      store.saveDocumentContent("doc-1", "rewritten candidate source", "text-hash-2"),
    ).rejects.toThrow(/IMMUTABLE_CANDIDATE_SOURCE_CONTENT/);

    await store.saveDocument(documentRecord("doc-2", "document-hash-2"));
    await store.saveDocumentContent("doc-2", "later candidate upload", "text-hash-2");
    await store.updateDocumentStage("doc-1", "READY", "COMPLETED");

    const resolved = await resolver.resolve(ref);
    expect(resolved.text).toBe("first immutable candidate source");
    expect(resolved.bytes).toEqual(Buffer.from("first immutable candidate source"));

    expect(() =>
      rawDb.prepare("UPDATE candidate_documents SET document_hash = ? WHERE id = ?").run("changed", "doc-1"),
    ).toThrow(/IMMUTABLE_CANDIDATE_DOCUMENT_SOURCE/);

    await expect(
      resolver.resolve({ ...ref, textHash: "tampered-reference" }),
    ).rejects.toBeInstanceOf(SourceSnapshotIdentityMismatchError);
  });

  it("keeps role text snapshots bound to the exact opportunity version while operational fields remain mutable", async () => {
    const rawDb = new Database(":memory:");
    createSchema(rawDb);
    applySourceImmutabilityMigration(rawDb);
    const db = new TestAdapter(rawDb);
    const resolver = new SourceSnapshotResolver(db);

    rawDb.prepare(`
      INSERT INTO opportunity_versions (
        id, canonical_job_id, content_hash, job_title, company_name, location,
        employment_type, raw_content, acquisition_status, category_ids, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "version-1", "job-1", "content-hash-1", "VP Sales", "Acme", "Gurugram",
      "Full-time", "first immutable role source", "ACQUIRED", "[]", "2026-09-13T00:00:00.000Z",
    );

    const ref = await resolver.captureOpportunityVersionRef("job-1", "version-1");
    expect(ref.sourcePayloadKey).toBeNull();
    expect(ref.sourcePayloadSha256).toBeNull();

    rawDb.prepare(`
      INSERT INTO opportunity_versions (
        id, canonical_job_id, content_hash, job_title, company_name, location,
        employment_type, raw_content, acquisition_status, category_ids, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "version-2", "job-1", "content-hash-2", "VP Sales", "Acme", "Gurugram",
      "Full-time", "later role source", "ACQUIRED", "[]", "2026-09-13T01:00:00.000Z",
    );

    expect(() =>
      rawDb.prepare("UPDATE opportunity_versions SET raw_content = ? WHERE id = ?").run("rewritten", "version-1"),
    ).toThrow(/IMMUTABLE_OPPORTUNITY_VERSION_SOURCE/);

    expect(() =>
      rawDb.prepare("UPDATE opportunity_versions SET acquisition_status = ?, category_ids = ? WHERE id = ?")
        .run("ENRICHED", '["EXECUTIVE"]', "version-1"),
    ).not.toThrow();

    const resolved = await resolver.resolve(ref);
    expect(resolved.text).toBe("first immutable role source");
    expect(resolved.ref).toEqual(ref);
  });

  it("binds binary role refs to both persisted key and exact blob digest", async () => {
    const rawDb = new Database(":memory:");
    createSchema(rawDb);
    applySourceImmutabilityMigration(rawDb);
    const db = new TestAdapter(rawDb);
    const blobStore = new MemoryBlobStore();
    const payloadKey = "opportunity-versions/version-pdf/source/sha256-manual";
    const bytes = Buffer.from("%PDF-1.7 immutable source bytes");
    await blobStore.put(payloadKey, bytes, "application/pdf");

    rawDb.prepare(`
      INSERT INTO opportunity_versions (
        id, canonical_job_id, content_hash, job_title, company_name, location,
        employment_type, raw_content, source_payload_key, source_media_type,
        document_extraction_state, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "version-pdf", "job-pdf", "content-hash-pdf", "Head of Sales", "Acme", "Delhi",
      "Full-time", "", payloadKey, "application/pdf", "PENDING", "2026-09-13T00:00:00.000Z",
    );

    const resolver = new SourceSnapshotResolver(db, blobStore);
    const ref = await resolver.captureOpportunityVersionRef("job-pdf", "version-pdf");
    expect(ref.sourcePayloadKey).toBe(payloadKey);
    expect(ref.sourcePayloadSha256).toBe(crypto.createHash("sha256").update(bytes).digest("hex"));

    const resolved = await resolver.resolve(ref);
    expect(resolved.storage).toBe("BLOB");
    expect(resolved.mediaType).toBe("application/pdf");
    expect(resolved.bytes).toEqual(bytes);

    expect(() =>
      rawDb.prepare("UPDATE opportunity_versions SET source_payload_key = ? WHERE id = ?")
        .run("other-key", "version-pdf"),
    ).toThrow(/IMMUTABLE_OPPORTUNITY_VERSION_SOURCE/);

    expect(() =>
      rawDb.prepare("UPDATE opportunity_versions SET raw_content = ? WHERE id = ?")
        .run("later extracted readable text", "version-pdf"),
    ).not.toThrow();
    expect((await resolver.resolve(ref)).bytes).toEqual(bytes);

    await blobStore.put(payloadKey, "mutated out-of-band bytes", "application/pdf");
    await expect(resolver.resolve(ref)).rejects.toBeInstanceOf(SourceSnapshotIdentityMismatchError);

    await blobStore.delete(payloadKey);
    await expect(resolver.resolve(ref)).rejects.toBeInstanceOf(SourceSnapshotUnavailableError);
  });

  it("content-addresses new PDF payloads and fails closed when the same opportunity version is replayed with different bytes", async () => {
    const rawDb = new Database(":memory:");
    createSchema(rawDb);
    applySourceImmutabilityMigration(rawDb);
    const db = new TestAdapter(rawDb);
    const blobStore = new MemoryBlobStore();
    const service = new CanonicalIngestionService(db, blobStore);
    const globalScope = { mode: "GLOBAL_MARKET" as const };
    const originalBytes = "first binary source bytes";

    const first = await service.ingestOpportunity(
      pdfPayload("immutable-pdf-1", originalBytes),
      globalScope,
    );

    const expectedDigest = crypto.createHash("sha256").update(Buffer.from(originalBytes)).digest("hex");
    expect(first.sourcePayloadKey).toBe(`opportunity-versions/${first.opportunityVersion}/source/sha256-${expectedDigest}`);
    await expect(
      service.ingestOpportunity(
        pdfPayload("immutable-pdf-1", "different binary source bytes"),
        globalScope,
      ),
    ).rejects.toThrow(/IMMUTABLE_OPPORTUNITY_SOURCE_CONFLICT/);

    const persisted = await blobStore.get(first.sourcePayloadKey!);
    expect(persisted?.toString("utf8")).toBe(originalBytes);

    const resolver = new SourceSnapshotResolver(db, blobStore);
    const ref = await resolver.captureOpportunityVersionRef(first.canonicalJobId, first.opportunityVersion);
    expect(ref.sourcePayloadSha256).toBe(expectedDigest);
  });

  it("arbitrates concurrent first writers without allowing cross-byte overwrite under one durable source identity", async () => {
    const rawDb = new Database(":memory:");
    createSchema(rawDb);
    applySourceImmutabilityMigration(rawDb);
    const db = new TestAdapter(rawDb);
    const blobStore = new MemoryBlobStore();
    const service = new CanonicalIngestionService(db, blobStore);
    const globalScope = { mode: "GLOBAL_MARKET" as const };

    const results = await Promise.allSettled([
      service.ingestOpportunity(pdfPayload("concurrent-pdf-1", "writer-a-bytes"), globalScope),
      service.ingestOpportunity(pdfPayload("concurrent-pdf-1", "writer-b-bytes"), globalScope),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejection = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(String(rejection?.reason?.message || rejection?.reason)).toMatch(/IMMUTABLE_OPPORTUNITY_SOURCE_CONFLICT/);

    const row = rawDb.prepare(
      "SELECT canonical_job_id, id, source_payload_key FROM opportunity_versions LIMIT 1",
    ).get() as { canonical_job_id: string; id: string; source_payload_key: string };
    const resolver = new SourceSnapshotResolver(db, blobStore);
    const ref = await resolver.captureOpportunityVersionRef(row.canonical_job_id, row.id);
    const resolved = await resolver.resolve(ref);
    expect(["writer-a-bytes", "writer-b-bytes"]).toContain(resolved.bytes.toString("utf8"));
    expect(row.source_payload_key).toContain(`/sha256-${ref.sourcePayloadSha256}`);
  });
});
