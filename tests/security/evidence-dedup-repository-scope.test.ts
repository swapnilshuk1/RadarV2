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
    raw.exec("INSERT INTO people (id, email) VALUES ('alice', 'alice@test'), ('bob', 'bob@test')");
  });
  async function seed(personId: string, documentId: string, graphId: string) {
    await store.saveDocument({ id: documentId, personId, filename: `${personId}.txt`, storageUri: "test", mimeType: "text/plain", documentHash: "same", status: "COMPLETED", stage: "COMPLETED", createdAt: "2026-01-01", updatedAt: "2026-01-01" });
    await store.saveDocumentContent(documentId, "same content", "same-hash");
    await store.saveEvidenceGraph({ id: graphId, personId, provenance: { documentId, extractorVersion: "test", promptVersion: "test", model: "test", createdAt: "2026-01-01" }, evidence: [] } as any);
  }
  test("same-person lookup ignores a newer identical graph owned by another candidate", async () => {
    await seed("bob", "bob-1", "bob-graph");
    await seed("alice", "alice-1", "alice-newer");
    expect((await store.findExistingEvidenceGraphByTextHash("same-hash", "bob"))?.id).toBe("bob-graph");
    expect((await store.findExistingEvidenceGraphByTextHash("same-hash", "alice"))?.id).toBe("alice-newer");
  });
});
