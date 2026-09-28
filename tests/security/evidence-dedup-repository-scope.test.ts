import { beforeEach, describe, expect, test } from "vitest";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { SqliteDocumentStore } from "../../src/data/sqlite/repositories/SqliteDocumentStore";

describe("evidence graph dedup repository ownership scope", () => {
  let raw: Database.Database;
  let store: SqliteDocumentStore;
  beforeEach(async () => {
    raw = new Database(":memory:");
    const db = new SqliteAdapter(raw);
    await runMigrations(db);
    store = new SqliteDocumentStore(db);
    raw.exec("INSERT INTO tenants (id,status) VALUES ('tenant-a','active'), ('tenant-b','active'); INSERT INTO people (id, email, tenant_id) VALUES ('alice', 'alice@test','tenant-a'), ('bob', 'bob@test','tenant-b')");
  });
  async function seed(personId: string, tenantId: string, documentId: string, graphId: string) {
    const scope={tenantId,personId};
    await store.saveDocument(scope, { id: documentId, tenantId, personId, filename: `${personId}.txt`, storageUri: "test", mimeType: "text/plain", documentHash: "same", status: "COMPLETED", stage: "COMPLETED", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    await store.saveDocumentContent(scope, documentId, "same content", "same-hash");
    await store.saveEvidenceGraph(scope, { id: graphId, personId, provenance: { documentId, extractorVersion: "test", promptVersion: "test", model: "test", createdAt: "2026-01-01" }, evidence: [] } as any);
  }
  test("same-person lookup ignores a newer identical graph owned by another candidate", async () => {
    await seed("bob", "tenant-b", "bob-1", "bob-graph");
    await seed("alice", "tenant-a", "alice-1", "alice-newer");
    expect((await store.findExistingEvidenceGraphByTextHash({tenantId:"tenant-b",personId:"bob"}, "same-hash"))?.id).toBe("bob-graph");
    expect((await store.findExistingEvidenceGraphByTextHash({tenantId:"tenant-a",personId:"alice"}, "same-hash"))?.id).toBe("alice-newer");
  });
});
