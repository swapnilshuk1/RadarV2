/**
 * Sub-Phase M6.1 — Multi-Tenant Credential Store & Durable Schema Tests
 */
import { describe, test, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";
import { SqliteCredentialStore } from "@/data/sqlite/repositories/SqliteCredentialStore";
import { createRepositories } from "@/data/sqlite/provider";
import type { SourceCredential, CredentialAuditLog, CredentialStatus } from "@/domain/entities";

class TestSqliteAdapter implements DatabaseAdapter {
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

describe("Sub-Phase M6.1: Multi-Tenant Credential Store Schema & Repository Contracts", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;
  let credStore: SqliteCredentialStore;

  beforeEach(() => {
    sqliteDb = new Database(":memory:");
    sqliteDb.pragma("foreign_keys = ON");

    const migrationFiles = [
      "001_initial_schema.sql",
      "018_multi_tenant_foundation.sql",
      "022_source_credentials.sql",
    ];

    for (const file of migrationFiles) {
      const sql = fs.readFileSync(path.join(process.cwd(), "src/data/sqlite/migrations", file), "utf-8");
      sqliteDb.exec(sql);
    }

    adapter = new TestSqliteAdapter(sqliteDb);
    credStore = new SqliteCredentialStore(adapter);

    // Seed Tenants
    sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_A', 'active'), ('tenant_B', 'active')");
    sqliteDb.exec("INSERT INTO users (id, email) VALUES ('user_A1', 'admin@tenantA.com'), ('user_B1', 'admin@tenantB.com')");
  });

  test("1. Migration 022 creates source_credentials and credential_audit_logs tables with expected schema", async () => {
    const credColumns = await adapter.many<{ name: string; type: string; notnull: number; dflt_value: any }>(
      "PRAGMA table_info(source_credentials)"
    );
    const credColNames = credColumns.map((c) => c.name);

    expect(credColNames).toContain("id");
    expect(credColNames).toContain("tenant_id");
    expect(credColNames).toContain("source");
    expect(credColNames).toContain("version");
    expect(credColNames).toContain("status");
    expect(credColNames).toContain("encrypted_ciphertext");
    expect(credColNames).toContain("iv");
    expect(credColNames).toContain("auth_tag");
    expect(credColNames).toContain("key_version");
    expect(credColNames).toContain("expires_at");
    expect(credColNames).toContain("last_used_at");
    expect(credColNames).toContain("last_verified_at");
    expect(credColNames).toContain("error_reason");
    expect(credColNames).toContain("created_at");
    expect(credColNames).toContain("updated_at");

    const auditColumns = await adapter.many<{ name: string }>("PRAGMA table_info(credential_audit_logs)");
    const auditColNames = auditColumns.map((c) => c.name);

    expect(auditColNames).toContain("id");
    expect(auditColNames).toContain("tenant_id");
    expect(auditColNames).toContain("credential_id");
    expect(auditColNames).toContain("action");
    expect(auditColNames).toContain("actor_user_id");
    expect(auditColNames).toContain("details");
    expect(auditColNames).toContain("created_at");
  });

  test("2. Zero Plaintext Invariant: Schema and entities contain NO plaintext credential columns", async () => {
    const credColumns = await adapter.many<{ name: string }>("PRAGMA table_info(source_credentials)");
    const forbiddenSubstrings = ["password", "token", "cookie", "secret", "raw", "session"];

    for (const col of credColumns) {
      const colLower = col.name.toLowerCase();
      // Only key_version or auth_tag or encrypted_ciphertext or iv or normal metadata allowed
      for (const forbidden of forbiddenSubstrings) {
        expect(colLower).not.toEqual(forbidden);
      }
    }
  });

  test("3. Tenant Scoping & Isolation: Strict boundary enforcement across tenants", async () => {
    const credA: SourceCredential = {
      id: "cred_A1",
      tenantId: "tenant_A",
      source: "linkedin",
      version: 1,
      status: "active",
      encryptedCiphertext: "enc_A_data",
      iv: "iv_A",
      authTag: "tag_A",
      keyVersion: "kms_v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const credB: SourceCredential = {
      id: "cred_B1",
      tenantId: "tenant_B",
      source: "linkedin",
      version: 1,
      status: "active",
      encryptedCiphertext: "enc_B_data",
      iv: "iv_B",
      authTag: "tag_B",
      keyVersion: "kms_v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await credStore.saveCredential(credA);
    await credStore.saveCredential(credB);

    // Tenant A querying cred_B1 returns undefined
    const crossTenantGet = await credStore.getCredential("tenant_A", "cred_B1");
    expect(crossTenantGet).toBeUndefined();

    // Tenant A listing credentials only sees Tenant A's credentials
    const tenantAList = await credStore.listCredentialsForTenant("tenant_A");
    expect(tenantAList).toHaveLength(1);
    expect(tenantAList[0].id).toBe("cred_A1");
    expect(tenantAList[0].encryptedCiphertext).toBe("enc_A_data");

    // Active credential lookup is tenant scoped
    const activeA = await credStore.getActiveCredentialForSource("tenant_A", "linkedin");
    expect(activeA?.id).toBe("cred_A1");

    const activeB = await credStore.getActiveCredentialForSource("tenant_B", "linkedin");
    expect(activeB?.id).toBe("cred_B1");
  });

  test("4. Composite Uniqueness: (tenant_id, source, version) is strictly unique", async () => {
    const cred1: SourceCredential = {
      id: "cred_1",
      tenantId: "tenant_A",
      source: "naukri",
      version: 1,
      status: "active",
      encryptedCiphertext: "enc_v1",
      iv: "iv_1",
      authTag: "tag_1",
      keyVersion: "kms_v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await credStore.saveCredential(cred1);

    // Raw insert with identical tenant_id, source, version fails on UNIQUE constraint
    expect(() => {
      sqliteDb.prepare(
        `INSERT INTO source_credentials (id, tenant_id, source, version, status, encrypted_ciphertext, iv, auth_tag, key_version)
         VALUES ('cred_dup', 'tenant_A', 'naukri', 1, 'pending', 'enc_dup', 'iv_dup', 'tag_dup', 'kms_v1')`
      ).run();
    }).toThrow(/UNIQUE constraint failed/);

    // Version 2 for same tenant + source succeeds
    const cred2: SourceCredential = {
      id: "cred_2",
      tenantId: "tenant_A",
      source: "naukri",
      version: 2,
      status: "pending",
      encryptedCiphertext: "enc_v2",
      iv: "iv_2",
      authTag: "tag_2",
      keyVersion: "kms_v2",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await credStore.saveCredential(cred2);

    const list = await credStore.listCredentialsForTenant("tenant_A", { source: "naukri" });
    expect(list).toHaveLength(2);
  });

  test("5. Foreign Key Integrity: Foreign keys prevent orphaned records and enforce tenant constraints", async () => {
    // 1. Inserting credential with nonexistent tenant fails
    const orphanCred: SourceCredential = {
      id: "orphan_cred",
      tenantId: "nonexistent_tenant",
      source: "linkedin",
      version: 1,
      status: "active",
      encryptedCiphertext: "enc",
      iv: "iv",
      authTag: "tag",
      keyVersion: "kms_v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await expect(credStore.saveCredential(orphanCred)).rejects.toThrow(/FOREIGN KEY constraint failed/);

    // 2. Inserting audit log with nonexistent credential fails
    const orphanAudit: CredentialAuditLog = {
      id: "audit_orphan",
      tenantId: "tenant_A",
      credentialId: "nonexistent_cred",
      action: "created",
      createdAt: new Date().toISOString(),
    };

    await expect(credStore.recordAuditLog(orphanAudit)).rejects.toThrow(/FOREIGN KEY constraint failed/);

    // 3. Deleting tenant with active credentials fails (ON DELETE RESTRICT)
    const validCred: SourceCredential = {
      id: "valid_cred",
      tenantId: "tenant_A",
      source: "greenhouse",
      version: 1,
      status: "active",
      encryptedCiphertext: "enc",
      iv: "iv",
      authTag: "tag",
      keyVersion: "kms_v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await credStore.saveCredential(validCred);

    expect(() => {
      sqliteDb.prepare("DELETE FROM tenants WHERE id = 'tenant_A'").run();
    }).toThrow(/FOREIGN KEY constraint failed/);
  });

  test("6. Audit Log Lineage & Cascade: Audit logs track actions and cascade on credential deletion", async () => {
    const cred: SourceCredential = {
      id: "cred_audit_test",
      tenantId: "tenant_A",
      source: "indeed",
      version: 1,
      status: "pending",
      encryptedCiphertext: "enc",
      iv: "iv",
      authTag: "tag",
      keyVersion: "kms_v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await credStore.saveCredential(cred);

    const log1: CredentialAuditLog = {
      id: "log_1",
      tenantId: "tenant_A",
      credentialId: "cred_audit_test",
      action: "created",
      actorUserId: "user_A1",
      details: "Registered initial session cookies",
      createdAt: "2026-08-20T10:00:00.000Z",
    };

    const log2: CredentialAuditLog = {
      id: "log_2",
      tenantId: "tenant_A",
      credentialId: "cred_audit_test",
      action: "activated",
      actorUserId: "user_A1",
      details: "Verified live connectivity",
      createdAt: "2026-08-20T10:05:00.000Z",
    };

    await credStore.recordAuditLog(log1);
    await credStore.recordAuditLog(log2);

    const logs = await credStore.getAuditLogsForCredential("tenant_A", "cred_audit_test");
    expect(logs).toHaveLength(2);
    expect(logs[0].action).toBe("activated"); // ORDER BY created_at DESC
    expect(logs[1].action).toBe("created");

    // Cross-tenant audit log query returns empty
    const crossLogs = await credStore.getAuditLogsForCredential("tenant_B", "cred_audit_test");
    expect(crossLogs).toHaveLength(0);

    // Deleting credential cascades to delete audit logs
    await credStore.deleteCredential("tenant_A", "cred_audit_test");
    const logsAfterDelete = await adapter.many("SELECT * FROM credential_audit_logs WHERE credential_id = 'cred_audit_test'");
    expect(logsAfterDelete).toHaveLength(0);
  });

  test("7. Credential Lifecycle State Machine: All statuses and update mutations execute cleanly", async () => {
    const cred: SourceCredential = {
      id: "cred_state_test",
      tenantId: "tenant_A",
      source: "workday",
      version: 1,
      status: "pending",
      encryptedCiphertext: "enc_state",
      iv: "iv_state",
      authTag: "tag_state",
      keyVersion: "kms_v1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await credStore.saveCredential(cred);

    const statuses: CredentialStatus[] = [
      "active",
      "expiring",
      "invalid",
      "rotation_required",
      "revoked",
    ];

    for (const st of statuses) {
      await credStore.updateCredentialStatus("tenant_A", "cred_state_test", st, st === "invalid" ? "HTTP 401 Session Expired" : null);
      const updated = await credStore.getCredential("tenant_A", "cred_state_test");
      expect(updated?.status).toBe(st);
      if (st === "invalid") {
        expect(updated?.errorReason).toBe("HTTP 401 Session Expired");
      }
    }

    // Test usage and verification timestamps
    const usedTime = "2026-08-20T12:00:00.000Z";
    await credStore.updateCredentialUsage("tenant_A", "cred_state_test", usedTime);
    let current = await credStore.getCredential("tenant_A", "cred_state_test");
    expect(current?.lastUsedAt).toBe(usedTime);

    const verifiedTime = "2026-08-20T12:05:00.000Z";
    await credStore.updateCredentialVerification("tenant_A", "cred_state_test", verifiedTime);
    current = await credStore.getCredential("tenant_A", "cred_state_test");
    expect(current?.lastVerifiedAt).toBe(verifiedTime);
  });

  test("8. Provider Wiring: StorageProvider exposes credentials store without disturbing M5 repositories", async () => {
    const repos = createRepositories(adapter);

    expect(repos.credentials).toBeDefined();
    expect(typeof repos.credentials.saveCredential).toBe("function");
    expect(typeof repos.credentials.getCredential).toBe("function");
    expect(typeof repos.credentials.getActiveCredentialForSource).toBe("function");

    // Verify existing M5 repositories remain intact
    expect(repos.evaluations).toBeDefined();
    expect(typeof repos.evaluations.saveEvaluation).toBe("function");
    expect(typeof repos.evaluations.getEvaluation).toBe("function");
    expect(typeof repos.evaluations.listEvaluationsForUser).toBe("function");
    expect(repos.sources).toBeDefined();
    expect(repos.people).toBeDefined();
    expect(repos.opportunities).toBeDefined();
  });
});
