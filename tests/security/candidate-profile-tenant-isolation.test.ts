import Database from "better-sqlite3";
import { beforeEach, describe, expect, test } from "vitest";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { runMigrations } from "../../src/data/sqlite/migrations/runner";
import { authenticateTenantMembership, authorizePersonScope, TenantIsolationError } from "../../src/lib/security/auth";
import { resolveServingScope } from "../../src/lib/security/scope-resolver";
import { SqliteDocumentStore } from "../../src/data/sqlite/repositories/SqliteDocumentStore";
import { SqliteStagedEvaluationStore } from "../../src/data/sqlite/repositories/SqliteStagedEvaluationStore";

describe("candidate profile tenant/person isolation", () => {
  let raw: Database.Database;
  let db: SqliteAdapter;
  let documents: SqliteDocumentStore;
  const scopeA = { tenantId: "tenant-a", personId: "person-a" };
  const scopeB = { tenantId: "tenant-b", personId: "person-b" };

  beforeEach(async () => {
    raw = new Database(":memory:"); db = new SqliteAdapter(raw); await runMigrations(db);
    documents = new SqliteDocumentStore(db);
    raw.exec(`
      INSERT INTO tenants(id,status) VALUES ('tenant-a','active'),('tenant-b','active');
      INSERT INTO users(id,email) VALUES ('user-a','user-a@test'),('user-b','user-b@test');
      INSERT INTO memberships(user_id,tenant_id,role,permissions,status) VALUES
        ('user-a','tenant-a','admin','[]','active'),('user-b','tenant-b','admin','[]','active');
      INSERT INTO people(id,email,tenant_id) VALUES
        ('person-a','person-a@test','tenant-a'),('person-b','person-b@test','tenant-b');
    `);
  });

  async function seed(scope = scopeA, id = "doc-a") {
    await documents.saveDocument(scope, { id, tenantId: scope.tenantId, personId: scope.personId, filename: "cv.txt", storageUri: "test", mimeType: "text/plain", documentHash: "same", status: "COMPLETED", stage: "READY", createdAt: "2026-09-26", updatedAt: "2026-09-26" });
    await documents.saveDocumentContent(scope, id, "same CV content", "same-text");
    await documents.saveEvidenceGraph(scope, { id: `graph-${id}`, personId: scope.personId, provenance: { documentId: id, extractorVersion: "test", promptVersion: "test", model: "test", createdAt: "2026-09-26" }, evidence: [] } as any);
  }

  test("authorizes a user distinct from the candidate only inside its tenant", async () => {
    const auth = await authenticateTenantMembership("user-a", "tenant-a", db);
    await expect(authorizePersonScope(auth, "person-a", db)).resolves.toEqual(scopeA);
    await expect(authorizePersonScope(auth, "person-b", db)).rejects.toBeInstanceOf(TenantIsolationError);
  });

  test("delegated candidate scope is authorized by membership even when actor and person are distinct identities", async () => {
    await expect(resolveServingScope("user-a", "tenant-a", db, "person-a")).resolves.toMatchObject({ scope: scopeA });
    await db.execute("INSERT INTO memberships(user_id,tenant_id,role,permissions,status) VALUES ('user-a','tenant-b','admin','[]','active')");
    await expect(resolveServingScope("user-a", "tenant-b", db, "person-b")).resolves.toMatchObject({ scope: scopeB });
  });

  test("delegated writes require write:person for non-admin memberships", async () => {
    await db.execute("UPDATE memberships SET role='member', permissions=? WHERE user_id='user-a' AND tenant_id='tenant-a'", [JSON.stringify(["read:person"])]);
    const auth = await authenticateTenantMembership("user-a", "tenant-a", db);
    await expect(authorizePersonScope(auth, "person-a", db, "read:person")).resolves.toEqual(scopeA);
    await expect(authorizePersonScope(auth, "person-a", db, "write:person")).rejects.toBeInstanceOf(TenantIsolationError);
    await db.execute("UPDATE memberships SET permissions=? WHERE user_id='user-a' AND tenant_id='tenant-a'", [JSON.stringify(["read:person", "write:person"])]);
    const writer = await authenticateTenantMembership("user-a", "tenant-a", db);
    await expect(authorizePersonScope(writer, "person-a", db, "write:person")).resolves.toEqual(scopeA);
  });

  test("a known document id cannot expose metadata, content, or evidence across a tenant/person scope", async () => {
    await seed();
    expect(await documents.getDocument(scopeB, "doc-a")).toBeUndefined();
    expect(await documents.getDocumentContent(scopeB, "doc-a")).toBeUndefined();
    expect(await documents.getEvidenceGraphForDocument(scopeB, "doc-a")).toBeUndefined();
  });

  test("same-person hash dedup remains local and never reuses another tenant's graph", async () => {
    await seed(scopeA, "doc-a-1");
    await seed(scopeB, "doc-b-1");
    expect((await documents.findExistingEvidenceGraphByTextHash(scopeA, "same-text"))?.id).toBe("graph-doc-a-1");
    expect((await documents.findExistingEvidenceGraphByTextHash(scopeB, "same-text"))?.id).toBe("graph-doc-b-1");
  });

  test("candidate source cache does not share identical content across tenant/person scopes", async () => {
    const cache = new SqliteStagedEvaluationStore(db);
    const key = { sourceFingerprint: "same-cv", modelId: "model", modelVersion: "v1" };
    await cache.cacheClaims(scopeA, key, { private: "A" }, [{ id: "A" }]);
    expect(await cache.cachedClaims(scopeA, key)).toEqual([{ id: "A" }]);
    expect(await cache.cachedClaims(scopeB, key)).toBeUndefined();
  });

  test("scoped document and intent writes preserve the candidate identity", async () => {
    await seed();
    await documents.saveCareerIntent(scopeA, { personId: "person-a", preferredLocations: ["Delhi"], targetTitles: ["Director"] });
    expect((await documents.getLatestCareerIntent(scopeA))?.personId).toBe("person-a");
    expect(await documents.getLatestCareerIntent(scopeB)).toBeUndefined();
  });
});
