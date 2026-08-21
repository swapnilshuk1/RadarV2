/**
 * Sub-Phase M6.3 — Credential Broker & JIT Leasing Engine Security & Invariant Tests
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  CredentialBroker,
  CredentialAuthorizationError,
  CredentialNotFoundError,
  CredentialLifecycleError,
  CredentialExpiredError,
  CredentialBrokerError,
  type CredentialLease,
} from "@/lib/security/CredentialBroker";
import {
  CredentialVault,
  DevDeterministicKeyProvider,
  CredentialAuthenticationError,
} from "@/lib/security/CredentialVault";
import { SqliteCredentialStore } from "@/data/sqlite/repositories/SqliteCredentialStore";
import { DatabaseAdapter, QueryParams } from "@/data/database/DatabaseAdapter";
import type { AuthContext } from "@/lib/security/auth";

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

describe("Sub-Phase M6.3: Credential Broker & JIT Leasing Engine Invariants", () => {
  let sqliteDb: Database.Database;
  let adapter: TestSqliteAdapter;
  let credStore: SqliteCredentialStore;
  let vault: CredentialVault;
  let broker: CredentialBroker;

  const authTenantA_Admin: AuthContext = {
    userId: "user_a_admin",
    tenantId: "tenant_a",
    permissions: ["manage:credentials", "read:credentials"],
  };

  const authTenantA_Reader: AuthContext = {
    userId: "user_a_reader",
    tenantId: "tenant_a",
    permissions: ["read:credentials"],
  };

  const authTenantA_NoCreds: AuthContext = {
    userId: "user_a_eval",
    tenantId: "tenant_a",
    permissions: ["read:evaluation", "write:evaluation"],
  };

  const authTenantB_Admin: AuthContext = {
    userId: "user_b_admin",
    tenantId: "tenant_b",
    permissions: ["manage:credentials", "read:credentials"],
  };

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

    // Seed tenants
    sqliteDb.exec("INSERT INTO tenants (id, status) VALUES ('tenant_a', 'active'), ('tenant_b', 'active')");

    adapter = new TestSqliteAdapter(sqliteDb);
    credStore = new SqliteCredentialStore(adapter);
    vault = new CredentialVault(new DevDeterministicKeyProvider());
    broker = new CredentialBroker(credStore, vault);
  });

  // ==========================================================================
  // SECTION 1: TENANT ISOLATION & BOUNDARY PROOF
  // ==========================================================================
  describe("1. Tenant Isolation & Cross-Tenant Guards", () => {
    test("Tenant B cannot lease, rotate, revoke, or report health on Tenant A credentials", async () => {
      const secret = "tenant_a_confidential_session_secret_123";
      const created = await broker.registerCredential(authTenantA_Admin, "linkedin", secret);

      // 1. Tenant B cannot lease Tenant A credential
      await expect(broker.leaseCredential(authTenantB_Admin, "linkedin")).rejects.toThrow(
        CredentialNotFoundError
      );

      // 2. Tenant B cannot revoke Tenant A credential
      await expect(broker.revokeCredential(authTenantB_Admin, created.id)).rejects.toThrow(
        CredentialNotFoundError
      );

      // 3. Tenant B cannot report health against Tenant A credential
      await expect(
        broker.reportCredentialHealth(authTenantB_Admin, created.id, "invalid", "Failed auth")
      ).rejects.toThrow(CredentialNotFoundError);

      // 4. Tenant B rotation creates a distinct Tenant B credential rather than modifying Tenant A
      const rotatedB = await broker.rotateCredential(
        authTenantB_Admin,
        "linkedin",
        "tenant_b_distinct_secret"
      );
      expect(rotatedB.tenantId).toBe("tenant_b");
      expect(rotatedB.version).toBe(1); // First for Tenant B

      // Verify Tenant A credential remains active and untouched
      const credA = await credStore.getCredential("tenant_a", created.id);
      expect(credA).toBeDefined();
      expect(credA?.status).toBe("active");
      expect(credA?.version).toBe(1);
    });
  });

  // ==========================================================================
  // SECTION 2: RBAC PERMISSION ENFORCEMENT & CANONICAL VOCABULARY
  // ==========================================================================
  describe("2. RBAC Permission Enforcement & Canonical Vocabulary", () => {
    test("Mutating operations strictly require 'manage:credentials' and reject generic permissions", async () => {
      const secret = "rbac_test_secret";

      // Generic permissions or un-scoped permissions are strictly rejected
      const authGenericManage: any = {
        userId: "user_generic",
        tenantId: "tenant_a",
        permissions: ["manage", "read"],
      };

      await expect(
        broker.registerCredential(authGenericManage, "naukri", secret)
      ).rejects.toThrow(CredentialAuthorizationError);

      await expect(
        broker.registerCredential(authTenantA_Reader, "naukri", secret)
      ).rejects.toThrow(CredentialAuthorizationError);

      await expect(
        broker.registerCredential(authTenantA_NoCreds, "naukri", secret)
      ).rejects.toThrow(CredentialAuthorizationError);

      // Register with canonical 'manage:credentials'
      const created = await broker.registerCredential(authTenantA_Admin, "naukri", secret);

      // Rotation without manage:credentials fails
      await expect(
        broker.rotateCredential(authTenantA_Reader, "naukri", "new_secret")
      ).rejects.toThrow(CredentialAuthorizationError);
      await expect(
        broker.rotateCredential(authGenericManage, "naukri", "new_secret")
      ).rejects.toThrow(CredentialAuthorizationError);

      // Revocation without manage:credentials fails
      await expect(
        broker.revokeCredential(authTenantA_Reader, created.id)
      ).rejects.toThrow(CredentialAuthorizationError);
      await expect(
        broker.revokeCredential(authGenericManage, created.id)
      ).rejects.toThrow(CredentialAuthorizationError);

      // Operational health reporting succeeds with read:credentials or manage:credentials
      await broker.reportCredentialHealth(authTenantA_Reader, created.id, "invalid", "tampered");
      await broker.reportCredentialHealth(authTenantA_Admin, created.id, "active");

      // Health report without credential permissions fails closed
      await expect(
        broker.reportCredentialHealth(authTenantA_NoCreds, created.id, "invalid", "tampered")
      ).rejects.toThrow(CredentialAuthorizationError);
      await expect(
        broker.reportCredentialHealth(authGenericManage, created.id, "invalid", "tampered")
      ).rejects.toThrow(CredentialAuthorizationError);
    });

    test("Leasing requires 'read:credentials' or 'manage:credentials'", async () => {
      const secret = "lease_rbac_secret";
      await broker.registerCredential(authTenantA_Admin, "greenhouse", secret);

      // Reader with 'read:credentials' succeeds
      const lease = await broker.leaseCredential(authTenantA_Reader, "greenhouse");
      expect(lease.secretPayload).toBe(secret);

      // Admin with 'manage:credentials' succeeds
      const adminLease = await broker.leaseCredential(authTenantA_Admin, "greenhouse");
      expect(adminLease.secretPayload).toBe(secret);

      // Generic 'read' without ':credentials' is rejected
      const authGenericRead: any = {
        userId: "user_gen_read",
        tenantId: "tenant_a",
        permissions: ["read"],
      };
      await expect(
        broker.leaseCredential(authGenericRead, "greenhouse")
      ).rejects.toThrow(CredentialAuthorizationError);

      // User with only evaluation permissions fails
      await expect(
        broker.leaseCredential(authTenantA_NoCreds, "greenhouse")
      ).rejects.toThrow(CredentialAuthorizationError);
    });
  });

  // ==========================================================================
  // SECTION 3: AUTHORIZATION PRECEDES DECRYPTION (HARD INVARIANT)
  // ==========================================================================
  describe("3. Authorization Precedes Decryption Invariant", () => {
    test("Decryption is NEVER invoked if authorization, tenant check, or lifecycle check fails", async () => {
      const decryptSpy = vi.spyOn(vault, "decrypt");

      const secret = "auth_before_decryption_secret";
      await broker.registerCredential(authTenantA_Admin, "smartrecruiters", secret);

      decryptSpy.mockClear();

      // 1. Unauthorized caller attempts lease -> fails BEFORE decrypt
      await expect(
        broker.leaseCredential(authTenantA_NoCreds, "smartrecruiters")
      ).rejects.toThrow(CredentialAuthorizationError);
      expect(decryptSpy).not.toHaveBeenCalled();

      // 2. Cross-tenant caller attempts lease -> fails BEFORE decrypt
      await expect(
        broker.leaseCredential(authTenantB_Admin, "smartrecruiters")
      ).rejects.toThrow(CredentialNotFoundError);
      expect(decryptSpy).not.toHaveBeenCalled();

      // 3. Authorized caller attempts lease -> succeeds and calls decrypt
      const lease = await broker.leaseCredential(authTenantA_Reader, "smartrecruiters");
      expect(decryptSpy).toHaveBeenCalledTimes(1);
      expect(lease.secretPayload).toBe(secret);
    });
  });

  // ==========================================================================
  // SECTION 4: JIT LEASING & ZERO PLAINTEXT PERSISTENCE
  // ==========================================================================
  describe("4. JIT Leasing & Plaintext Non-Retention", () => {
    test("Broker does not persist, log, audit, cache, or retain plaintext payload", async () => {
      const secret = "jit_memory_only_session_token_xyz";
      const created = await broker.registerCredential(authTenantA_Admin, "workday", secret);

      const beforeLeaseTime = Date.now();
      const lease = await broker.leaseCredential(authTenantA_Reader, "workday");

      // Verify transient lease structure
      expect(lease.credentialId).toBe(created.id);
      expect(lease.tenantId).toBe("tenant_a");
      expect(lease.source).toBe("workday");
      expect(lease.version).toBe(1);
      expect(lease.secretPayload).toBe(secret);

      // Verify DB row remains ciphertext only
      const rawDbRow = await adapter.one<any>(
        "SELECT * FROM source_credentials WHERE id = ?",
        [created.id]
      );
      expect(rawDbRow.encrypted_ciphertext).toBeDefined();
      expect(rawDbRow.encrypted_ciphertext).not.toContain(secret);
      expect(rawDbRow.last_used_at).toBeDefined();
      const lastUsedTimestamp = new Date(rawDbRow.last_used_at).getTime();
      expect(lastUsedTimestamp).toBeGreaterThanOrEqual(beforeLeaseTime - 1000);

      // Verify audit event contains no secret
      const auditLogs = await credStore.getAuditLogsForCredential("tenant_a", created.id);
      const leasedLog = auditLogs.find((l) => l.action === "leased");
      expect(leasedLog).toBeDefined();
      expect(leasedLog?.actorUserId).toBe("user_a_reader");
      expect(leasedLog?.details).not.toContain(secret);
    });
  });

  // ==========================================================================
  // SECTION 5: EXPIRY SEMANTICS
  // ==========================================================================
  describe("5. Expiry Semantics", () => {
    test("Past expiry (< now) rejects lease, marks credential invalid, and records audit log", async () => {
      const secret = "expired_secret";
      const pastTime = new Date(Date.now() - 3600 * 1000).toISOString(); // 1 hr ago

      const created = await broker.registerCredential(
        authTenantA_Admin,
        "lever",
        secret,
        pastTime
      );

      // Attempt to lease expired credential
      await expect(broker.leaseCredential(authTenantA_Reader, "lever")).rejects.toThrow(
        CredentialExpiredError
      );

      // Verify status was updated to invalid
      const cred = await credStore.getCredential("tenant_a", created.id);
      expect(cred?.status).toBe("invalid");

      // Verify audit log for invalidation
      const auditLogs = await credStore.getAuditLogsForCredential("tenant_a", created.id);
      const invalidLog = auditLogs.find((l) => l.action === "invalidated");
      expect(invalidLog).toBeDefined();
    });

    test("Future expiry (> now) allows lease successfully", async () => {
      const secret = "valid_future_secret";
      const futureTime = new Date(Date.now() + 86400 * 1000).toISOString(); // 24 hrs from now

      await broker.registerCredential(
        authTenantA_Admin,
        "naukri",
        secret,
        futureTime
      );

      const lease = await broker.leaseCredential(authTenantA_Reader, "naukri");
      expect(lease.secretPayload).toBe(secret);
    });
  });

  // ==========================================================================
  // SECTION 6: LIFECYCLE TRANSITIONS & ELIGIBILITY
  // ==========================================================================
  describe("6. Lifecycle Transitions & State Machine", () => {
    test("Legal transitions succeed and illegal transitions fail", async () => {
      const secret = "lifecycle_test_secret";
      const cred = await broker.registerCredential(authTenantA_Admin, "linkedin", secret);

      // 1. active -> expiring: valid
      await broker.reportCredentialHealth(authTenantA_Admin, cred.id, "expiring");
      let current = await credStore.getCredential("tenant_a", cred.id);
      expect(current?.status).toBe("expiring");

      // 2. expiring -> active: valid
      await broker.reportCredentialHealth(authTenantA_Admin, cred.id, "active");
      current = await credStore.getCredential("tenant_a", cred.id);
      expect(current?.status).toBe("active");

      // 3. active -> invalid: valid
      await broker.reportCredentialHealth(authTenantA_Admin, cred.id, "invalid", "Session cookie expired");
      current = await credStore.getCredential("tenant_a", cred.id);
      expect(current?.status).toBe("invalid");

      // 4. invalid credentials cannot be leased (throws CredentialLifecycleError)
      await expect(broker.leaseCredential(authTenantA_Reader, "linkedin")).rejects.toThrow(
        CredentialLifecycleError
      );

      // 5. invalid -> active: valid (re-authenticated)
      await broker.reportCredentialHealth(authTenantA_Admin, cred.id, "active");
      current = await credStore.getCredential("tenant_a", cred.id);
      expect(current?.status).toBe("active");

      // 6. active -> rotation_required: valid
      await broker.reportCredentialHealth(authTenantA_Admin, cred.id, "rotation_required");
      current = await credStore.getCredential("tenant_a", cred.id);
      expect(current?.status).toBe("rotation_required");

      // 7. rotation_required -> active: ILLEGAL (cannot resurrect superseded credential)
      await expect(
        broker.reportCredentialHealth(authTenantA_Admin, cred.id, "active")
      ).rejects.toThrow(CredentialLifecycleError);

      // 8. rotation_required -> invalid: valid
      await broker.reportCredentialHealth(authTenantA_Admin, cred.id, "invalid");
      current = await credStore.getCredential("tenant_a", cred.id);
      expect(current?.status).toBe("invalid");

      // 9. invalid -> active -> revoked: valid
      await broker.reportCredentialHealth(authTenantA_Admin, cred.id, "active");
      await broker.revokeCredential(authTenantA_Admin, cred.id, "Revoked for test");
      current = await credStore.getCredential("tenant_a", cred.id);
      expect(current?.status).toBe("revoked");

      // 10. revoked -> active: ILLEGAL (revoked is a terminal state)
      await expect(
        broker.reportCredentialHealth(authTenantA_Admin, cred.id, "active")
      ).rejects.toThrow(CredentialLifecycleError);

      // 11. revoked -> rotation_required: ILLEGAL
      await expect(
        broker.reportCredentialHealth(authTenantA_Admin, cred.id, "rotation_required")
      ).rejects.toThrow(CredentialLifecycleError);
    });
  });

  // ==========================================================================
  // SECTION 7: ATOMIC ROTATION & TRANSACTIONAL FAILURE INJECTION
  // ==========================================================================
  describe("7. Atomic Rotation & Transactional Failure Injection", () => {
    test("Successful rotation performs atomic version transition and audit lineage", async () => {
      const secretV1 = "secret_payload_version_1";
      const secretV2 = "secret_payload_version_2";

      // Register v1
      const v1 = await broker.registerCredential(authTenantA_Admin, "linkedin", secretV1);
      expect(v1.version).toBe(1);
      expect(v1.status).toBe("active");

      // Rotate to v2
      const v2 = await broker.rotateCredential(authTenantA_Admin, "linkedin", secretV2);
      expect(v2.version).toBe(2);
      expect(v2.status).toBe("active");
      expect(v2.id).not.toBe(v1.id);

      // Verify v1 was marked 'rotation_required' (superseded)
      const v1Updated = await credStore.getCredential("tenant_a", v1.id);
      expect(v1Updated?.status).toBe("rotation_required");

      // Verify lease returns latest active version (v2)
      const lease = await broker.leaseCredential(authTenantA_Reader, "linkedin");
      expect(lease.version).toBe(2);
      expect(lease.credentialId).toBe(v2.id);
      expect(lease.secretPayload).toBe(secretV2);

      // Verify audit logs
      const auditV2 = await credStore.getAuditLogsForCredential("tenant_a", v2.id);
      const rotatedLog = auditV2.find((l) => l.action === "rotated");
      expect(rotatedLog).toBeDefined();
      expect(rotatedLog?.actorUserId).toBe("user_a_admin");
      expect(rotatedLog?.details).toContain('"version":2');
      expect(rotatedLog?.details).toContain('"supersededVersion":1');
    });

    test("Failure Injection Stage 1: Injected failure during old version update rolls back atomically", async () => {
      const secretV1 = "atomic_secret_v1_stage1";
      const v1 = await broker.registerCredential(authTenantA_Admin, "linkedin", secretV1);

      const originalExecute = adapter.execute.bind(adapter);
      let failureInjected = false;

      vi.spyOn(adapter, "execute").mockImplementation(async (sql, params) => {
        if (typeof sql === "string" && sql.includes("UPDATE source_credentials") && !failureInjected) {
          failureInjected = true;
          throw new Error("SIMULATED_STAGE_1_STATUS_UPDATE_FAILURE");
        }
        return originalExecute(sql, params);
      });

      await expect(
        broker.rotateCredential(authTenantA_Admin, "linkedin", "atomic_secret_v2")
      ).rejects.toThrow("SIMULATED_STAGE_1_STATUS_UPDATE_FAILURE");

      const v1Post = await credStore.getCredential("tenant_a", v1.id);
      expect(v1Post?.status).toBe("active");

      const allCreds = await credStore.listCredentialsForTenant("tenant_a", { source: "linkedin" });
      expect(allCreds.length).toBe(1);
      expect(allCreds[0].version).toBe(1);
    });

    test("Failure Injection Stage 2: Injected failure during new credential insert rolls back atomically", async () => {
      const secretV1 = "atomic_secret_v1_stage2";
      const v1 = await broker.registerCredential(authTenantA_Admin, "linkedin", secretV1);

      const originalExecute = adapter.execute.bind(adapter);
      let failureInjected = false;

      vi.spyOn(adapter, "execute").mockImplementation(async (sql, params) => {
        if (typeof sql === "string" && sql.includes("INSERT INTO source_credentials") && !failureInjected) {
          failureInjected = true;
          throw new Error("SIMULATED_STAGE_2_NEW_CREDENTIAL_INSERT_FAILURE");
        }
        return originalExecute(sql, params);
      });

      await expect(
        broker.rotateCredential(authTenantA_Admin, "linkedin", "atomic_secret_v2")
      ).rejects.toThrow("SIMULATED_STAGE_2_NEW_CREDENTIAL_INSERT_FAILURE");

      // Old version MUST still be active (not rotation_required)
      const v1Post = await credStore.getCredential("tenant_a", v1.id);
      expect(v1Post?.status).toBe("active");

      // Version 2 MUST NOT exist
      const allCreds = await credStore.listCredentialsForTenant("tenant_a", { source: "linkedin" });
      expect(allCreds.length).toBe(1);
      expect(allCreds[0].version).toBe(1);
    });

    test("Failure Injection Stage 3: Injected failure during audit insertion rolls back all mutations atomically", async () => {
      const secretV1 = "atomic_secret_v1_stage3";
      const v1 = await broker.registerCredential(authTenantA_Admin, "linkedin", secretV1);

      const originalExecute = adapter.execute.bind(adapter);
      let failureInjected = false;

      vi.spyOn(adapter, "execute").mockImplementation(async (sql, params) => {
        if (typeof sql === "string" && sql.includes("INSERT INTO credential_audit_logs") && !failureInjected) {
          failureInjected = true;
          throw new Error("SIMULATED_STAGE_3_AUDIT_INSERT_FAILURE");
        }
        return originalExecute(sql, params);
      });

      await expect(
        broker.rotateCredential(authTenantA_Admin, "linkedin", "atomic_secret_v2")
      ).rejects.toThrow("SIMULATED_STAGE_3_AUDIT_INSERT_FAILURE");

      // 1. Old version v1 MUST remain 'active'
      const v1PostFailure = await credStore.getCredential("tenant_a", v1.id);
      expect(v1PostFailure?.status).toBe("active");

      // 2. Version 2 MUST NOT exist in the database
      const allCreds = await credStore.listCredentialsForTenant("tenant_a", { source: "linkedin" });
      expect(allCreds.length).toBe(1);
      expect(allCreds[0].version).toBe(1);

      // 3. Rotation audit log for v2 MUST NOT exist
      const allAuditLogs = await credStore.listAuditLogsForTenant("tenant_a");
      const rotatedAudit = allAuditLogs.find((l) => l.action === "rotated");
      expect(rotatedAudit).toBeUndefined();
    });
  });

  // ==========================================================================
  // SECTION 8: ZERO PLAINTEXT SENTINEL LEAKAGE TEST
  // ==========================================================================
  describe("8. Sentinel Secret Zero-Leakage Invariant", () => {
    test("Sentinel secret RADAR_TEST_SECRET_DO_NOT_LEAK never appears in DB, audit, or errors", async () => {
      const sentinel = "RADAR_TEST_SECRET_DO_NOT_LEAK_XYZ_999";

      const created = await broker.registerCredential(authTenantA_Admin, "workday", sentinel);

      // 1. Check all database tables
      const credRows = await adapter.many<any>("SELECT * FROM source_credentials");
      for (const row of credRows) {
        for (const [col, val] of Object.entries(row)) {
          if (typeof val === "string") {
            expect(val).not.toContain(sentinel);
          }
        }
      }

      const auditRows = await adapter.many<any>("SELECT * FROM credential_audit_logs");
      for (const row of auditRows) {
        for (const [col, val] of Object.entries(row)) {
          if (typeof val === "string") {
            expect(val).not.toContain(sentinel);
          }
        }
      }

      // 2. Check error messages on failed operations
      try {
        await broker.reportCredentialHealth(authTenantA_Admin, "non_existent_id", "invalid");
        expect.unreachable();
      } catch (err: any) {
        expect(err.message).not.toContain(sentinel);
      }
    });
  });

  // ==========================================================================
  // SECTION 9: MECHANICAL ARCHITECTURE & DEPENDENCY BOUNDARIES
  // ==========================================================================
  describe("9. Mechanical Architecture & Boundary Tests", () => {
    test("CredentialBroker depends strictly on CredentialVault and CredentialStore without crypto ciphers or raw SQL", () => {
      const brokerSrcPath = path.join(process.cwd(), "src/lib/security/CredentialBroker.ts");
      const srcContent = fs.readFileSync(brokerSrcPath, "utf-8");

      // Must NOT directly call createCipheriv or createDecipheriv (strictly via CredentialVault)
      expect(srcContent).not.toContain("createCipheriv");
      expect(srcContent).not.toContain("createDecipheriv");

      // Must NOT directly execute raw SQL queries (strictly via CredentialStore)
      expect(srcContent).not.toContain("SELECT ");
      expect(srcContent).not.toContain("INSERT INTO");
      expect(srcContent).not.toContain("UPDATE ");

      // Must NOT import scraper or evaluation pipeline
      expect(srcContent).not.toContain("OpportunityProvider");
      expect(srcContent).not.toContain("runEngine");
      expect(srcContent).not.toContain("playwright");
      expect(srcContent).not.toContain("evaluation_jobs");
    });
  });
});
