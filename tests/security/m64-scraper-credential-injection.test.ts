import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { SqliteCredentialStore } from "../../src/data/sqlite/repositories/SqliteCredentialStore";
import {
  CredentialBroker,
  CredentialAuthorizationError,
  CredentialLifecycleError,
  CredentialExpiredError,
  CredentialNotFoundError,
} from "../../src/lib/security/CredentialBroker";
import {
  PlaywrightCredentialInjector,
  CredentialPayloadError,
  CredentialDomainSecurityError,
  CredentialHeaderSecurityError,
  PORTAL_DOMAINS,
  PORTAL_REGISTRABLE_DOMAINS,
} from "../../src/lib/security/PlaywrightCredentialInjector";
import {
  establishPortalAuthSession,
  type PortalAuthSession,
} from "../../src/lib/security/PortalAuthSession";
import { sanitizeDiagnosticValue, dumpFailureArtifacts } from "../../scripts/scraper/utils/failure-dump";
import type { DatabaseAdapter, QueryParams } from "../../src/data/database/DatabaseAdapter";
import type { AuthContext } from "../../src/lib/security/auth";
import fs from "fs";
import path from "path";
import { ARTIFACTS_DIR } from "../../scripts/scraper/config";

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

describe("Sub-Phase M6.4 — Scraper Authentication & JIT Credential Injection", () => {
  let rawDb: Database.Database;
  let db: DatabaseAdapter;
  let store: SqliteCredentialStore;
  let broker: CredentialBroker;
  let mockBrowserContext: MockBrowserContext;

  const tenantAAuth: AuthContext = {
    tenantId: "tenant_a",
    userId: "user_a",
    permissions: ["read:credentials", "manage:credentials"],
  };

  const tenantBAuth: AuthContext = {
    tenantId: "tenant_b",
    userId: "user_b",
    permissions: ["read:credentials", "manage:credentials"],
  };

  const readOnlyAuth: AuthContext = {
    tenantId: "tenant_a",
    userId: "user_readonly",
    permissions: ["read:credentials"],
  };

  const unauthorizedAuth: AuthContext = {
    tenantId: "tenant_a",
    userId: "user_unauthorized",
    permissions: ["read:evaluation"],
  };

  // Mock Playwright BrowserContext
  class MockBrowserContext {
    public injectedCookies: any[] = [];
    public injectedHeaders: Record<string, string> = {};

    async addCookies(cookies: any[]): Promise<void> {
      this.injectedCookies.push(...cookies);
    }

    async setExtraHTTPHeaders(headers: Record<string, string>): Promise<void> {
      this.injectedHeaders = { ...this.injectedHeaders, ...headers };
    }

    reset(): void {
      this.injectedCookies = [];
      this.injectedHeaders = {};
    }
  }

  beforeEach(async () => {
    rawDb = new Database(":memory:");
    rawDb.pragma("foreign_keys = ON");
    db = new TestSqliteAdapter(rawDb);
    store = new SqliteCredentialStore(db);
    broker = new CredentialBroker(store);
    mockBrowserContext = new MockBrowserContext();

    const migrationsDir = path.join(process.cwd(), "src", "data", "sqlite", "migrations");
    const migrationFiles = [
      "001_initial_schema.sql",
      "018_multi_tenant_foundation.sql",
      "022_source_credentials.sql",
    ];

    for (const file of migrationFiles) {
      const filePath = path.join(migrationsDir, file);
      if (fs.existsSync(filePath)) {
        const sql = fs.readFileSync(filePath, "utf-8");
        rawDb.exec(sql);
      }
    }

    // Seed tenants
    rawDb.prepare(`INSERT OR IGNORE INTO tenants (id, status) VALUES (?, ?)`).run(
      "tenant_a",
      "active"
    );
    rawDb.prepare(`INSERT OR IGNORE INTO tenants (id, status) VALUES (?, ?)`).run(
      "tenant_b",
      "active"
    );

    // Register valid active credential for LinkedIn and Naukri
    await broker.registerCredential(
      tenantAAuth,
      "linkedin",
      JSON.stringify({
        cookies: [
          { name: "li_at", value: "SENTINEL_LI_AT_SECRET_123", domain: ".linkedin.com", path: "/" },
          { name: "JSESSIONID", value: "ajax:987654321", domain: ".linkedin.com", path: "/" },
        ],
      })
    );

    await broker.registerCredential(
      tenantAAuth,
      "naukri",
      JSON.stringify({
        nauk_auth: "SENTINEL_NAUKRI_SECRET_456",
      })
    );
  });

  describe("Invariant 1: Lease-Only Acquisition via Broker", () => {
    it("leases credentials through CredentialBroker and injects into browser context", async () => {
      const authSession = await establishPortalAuthSession(
        broker,
        tenantAAuth,
        "linkedin",
        mockBrowserContext as any
      );

      expect(authSession).not.toBeNull();
      expect(authSession?.tenantId).toBe("tenant_a");
      expect(authSession?.source).toBe("linkedin");
      expect(authSession?.version).toBe(1);

      // Verify BrowserContext received injected cookies
      expect(mockBrowserContext.injectedCookies.length).toBe(2);
      expect(mockBrowserContext.injectedCookies[0].name).toBe("li_at");
      expect(mockBrowserContext.injectedCookies[0].domain).toBe(".linkedin.com");
      expect(mockBrowserContext.injectedCookies[1].name).toBe("JSESSIONID");
    });
  });

  describe("Invariant 2: Authorization-Before-Injection & Strict Error Attribution", () => {
    it("fails closed with CredentialAuthorizationError if auth lacks permissions and leaves browser unmutated", async () => {
      await expect(
        establishPortalAuthSession(
          broker,
          unauthorizedAuth,
          "linkedin",
          mockBrowserContext as any
        )
      ).rejects.toThrow(CredentialAuthorizationError);

      expect(mockBrowserContext.injectedCookies.length).toBe(0);
      expect(Object.keys(mockBrowserContext.injectedHeaders).length).toBe(0);
    });

    it("fails closed with CredentialLifecycleError if credential is revoked or inactive and leaves browser unmutated", async () => {
      const creds = await store.listCredentialsForTenant("tenant_a");
      const liCred = creds.find((c) => c.source === "linkedin")!;
      await broker.revokeCredential(tenantAAuth, liCred.id, "Security incident");

      await expect(
        establishPortalAuthSession(
          broker,
          tenantAAuth,
          "linkedin",
          mockBrowserContext as any
        )
      ).rejects.toThrow(CredentialLifecycleError);

      expect(mockBrowserContext.injectedCookies.length).toBe(0);
    });

    it("returns null ONLY when credential is not configured (CredentialNotFoundError), enabling anonymous fallback", async () => {
      // "indeed" has no credential registered in tenant_a
      const authSession = await establishPortalAuthSession(
        broker,
        tenantAAuth,
        "indeed",
        mockBrowserContext as any
      );

      expect(authSession).toBeNull();
      expect(mockBrowserContext.injectedCookies.length).toBe(0);
    });

    it("propagates unexpected broker errors and does NOT silently decay into anonymous scraping", async () => {
      const brokenBroker: any = {
        leaseCredential: async () => {
          throw new Error("Unexpected database connection crash");
        },
      };

      await expect(
        establishPortalAuthSession(
          brokenBroker,
          tenantAAuth,
          "linkedin",
          mockBrowserContext as any
        )
      ).rejects.toThrow("Unexpected database connection crash");

      expect(mockBrowserContext.injectedCookies.length).toBe(0);
    });
  });

  describe("Invariant 3: Atomic Fail-Closed Payload Validation", () => {
    it("rejects malformed JSON payloads without mutating browser context", async () => {
      const malformedPayload = "{ cookies: [ { name: 'li_at' "; // syntax error
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(
          mockBrowserContext as any,
          "linkedin",
          malformedPayload
        )
      ).rejects.toThrow(CredentialPayloadError);

      expect(mockBrowserContext.injectedCookies.length).toBe(0);
    });

    it("rejects empty cookie arrays or empty strings fail-closed", async () => {
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(
          mockBrowserContext as any,
          "linkedin",
          "[]"
        )
      ).rejects.toThrow(CredentialPayloadError);

      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(
          mockBrowserContext as any,
          "linkedin",
          "   "
        )
      ).rejects.toThrow(CredentialPayloadError);

      expect(mockBrowserContext.injectedCookies.length).toBe(0);
    });

    it("performs zero partial injection if second cookie in array has an error", async () => {
      const partialCorruptPayload = JSON.stringify([
        { name: "li_at", value: "valid_token", domain: ".linkedin.com" },
        { name: "", value: "missing_name", domain: ".linkedin.com" }, // invalid
      ]);

      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(
          mockBrowserContext as any,
          "linkedin",
          partialCorruptPayload
        )
      ).rejects.toThrow(CredentialPayloadError);

      // Verify ZERO cookies were injected (no partial injection)
      expect(mockBrowserContext.injectedCookies.length).toBe(0);
    });
  });

  describe("Invariant 4: Strict Domain Isolation & Registrable Domain Boundary Enforcement", () => {
    it("permits canonical portal domains and trusted subdomains", () => {
      // Exact canonical
      expect(PlaywrightCredentialInjector.isPermittedDomain("linkedin", ".linkedin.com")).toBe(true);
      expect(PlaywrightCredentialInjector.isPermittedDomain("linkedin", "linkedin.com")).toBe(true);
      expect(PlaywrightCredentialInjector.isPermittedDomain("linkedin", "www.linkedin.com")).toBe(true);
      expect(PlaywrightCredentialInjector.isPermittedDomain("naukri", ".naukri.com")).toBe(true);
      expect(PlaywrightCredentialInjector.isPermittedDomain("indeed", ".indeed.com")).toBe(true);

      // Trusted subdomains
      expect(PlaywrightCredentialInjector.isPermittedDomain("linkedin", "in.linkedin.com")).toBe(true);
      expect(PlaywrightCredentialInjector.isPermittedDomain("linkedin", "touch.linkedin.com")).toBe(true);
      expect(PlaywrightCredentialInjector.isPermittedDomain("naukri", "careers.naukri.com")).toBe(true);
      expect(PlaywrightCredentialInjector.isPermittedDomain("indeed", "employers.indeed.com")).toBe(true);
    });

    it("strictly rejects domain suffix spoofing attacks", () => {
      expect(PlaywrightCredentialInjector.isPermittedDomain("linkedin", ".evil-linkedin.com")).toBe(false);
      expect(PlaywrightCredentialInjector.isPermittedDomain("linkedin", "linkedin.com.evil.com")).toBe(false);
      expect(PlaywrightCredentialInjector.isPermittedDomain("linkedin", ".evil.com")).toBe(false);
      expect(PlaywrightCredentialInjector.isPermittedDomain("linkedin", "attacker.com/linkedin.com")).toBe(false);
      expect(PlaywrightCredentialInjector.isPermittedDomain("linkedin", "linkedin.com:8080@evil.com")).toBe(false);
    });

    it("throws CredentialDomainSecurityError when payload contains forbidden domain", async () => {
      const maliciousDomainPayload = JSON.stringify([
        { name: "li_at", value: "SECRET", domain: ".evil-linkedin.com" },
      ]);

      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(
          mockBrowserContext as any,
          "linkedin",
          maliciousDomainPayload
        )
      ).rejects.toThrow(CredentialDomainSecurityError);

      expect(mockBrowserContext.injectedCookies.length).toBe(0);
    });
  });

  describe("Invariant 5: Header Isolation & Forbidden Header Policy", () => {
    it("allows permitted custom headers", async () => {
      const validHeaderPayload = JSON.stringify({
        headers: {
          Authorization: "Bearer VALID_AUTH_TOKEN_789",
          "x-custom-api-key": "custom_key_val",
        },
      });

      const res = await PlaywrightCredentialInjector.injectIntoBrowserContext(
        mockBrowserContext as any,
        "linkedin",
        validHeaderPayload
      );

      expect(res.headerCount).toBe(2);
      expect(mockBrowserContext.injectedHeaders["Authorization"]).toBe("Bearer VALID_AUTH_TOKEN_789");
      expect(mockBrowserContext.injectedHeaders["x-custom-api-key"]).toBe("custom_key_val");
    });

    it("strictly rejects 'Cookie' header to prevent domain validation bypass", async () => {
      const bypassPayload = JSON.stringify({
        headers: {
          Cookie: "li_at=ATTACKER_SECRET; domain=.evil.com",
        },
      });

      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(
          mockBrowserContext as any,
          "linkedin",
          bypassPayload
        )
      ).rejects.toThrow(CredentialHeaderSecurityError);

      expect(Object.keys(mockBrowserContext.injectedHeaders).length).toBe(0);
    });

    it("strictly rejects forbidden transport headers like Host or Content-Length", async () => {
      const badHostPayload = JSON.stringify({
        headers: {
          Host: "evil.com",
        },
      });

      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(
          mockBrowserContext as any,
          "linkedin",
          badHostPayload
        )
      ).rejects.toThrow(CredentialHeaderSecurityError);

      expect(Object.keys(mockBrowserContext.injectedHeaders).length).toBe(0);
    });
  });

  describe("Invariant 6: Secret Non-Observability & Sanitization", () => {
    it("sanitizes Bearer tokens, cookies, and JSON credential keys from diagnostic strings", () => {
      const rawError = "Error connecting with Bearer TOKEN_ALPHA_999 and li_at=SECRET_COOKIE_VAL";
      const sanitized = sanitizeDiagnosticValue(rawError);

      expect(sanitized).not.toContain("TOKEN_ALPHA_999");
      expect(sanitized).not.toContain("SECRET_COOKIE_VAL");
      expect(sanitized).toContain("Bearer [REDACTED]");
      expect(sanitized).toContain("li_at= [REDACTED]");
    });

    it("sanitizes failure dump artifacts written to disk", async () => {
      const mockPage: any = {
        url: () => "https://www.linkedin.com/login?token=SENSITIVE_SESSION_QUERY",
        title: async () => "LinkedIn Login with li_at=SECRET_LEAK",
        content: async () => "<html><body>Safe body</body></html>",
        screenshot: async () => Buffer.from(""),
      };

      const runId = "test_run_sanitize";
      const today = new Date().toISOString().split("T")[0];
      const failureDir = path.join(ARTIFACTS_DIR, "failures", today, runId, "linkedin");
      if (fs.existsSync(failureDir)) {
        fs.rmSync(path.join(ARTIFACTS_DIR, "failures", today, runId), { recursive: true, force: true });
      }

      await dumpFailureArtifacts(
        runId,
        "LinkedIn",
        mockPage,
        "Auth failed for secretPayload: SENTINEL_DO_NOT_LEAK"
      );

      if (fs.existsSync(failureDir)) {
        const files = fs.readdirSync(failureDir);
        for (const file of files) {
          if (file.endsWith(".txt")) {
            const content = fs.readFileSync(path.join(failureDir, file), "utf8");
            expect(content).not.toContain("SENTINEL_DO_NOT_LEAK");
            expect(content).not.toContain("SECRET_LEAK");
          }
        }
        // Cleanup test artifacts
        fs.rmSync(path.join(ARTIFACTS_DIR, "failures", today, runId), { recursive: true, force: true });
      }
    });
  });

  describe("Invariant 7: Strict Tenant Isolation", () => {
    it("prevents Tenant B from leasing or injecting Tenant A's source credential", async () => {
      const authSessionB = await establishPortalAuthSession(
        broker,
        tenantBAuth,
        "linkedin",
        mockBrowserContext as any
      );

      expect(authSessionB).toBeNull();
      expect(mockBrowserContext.injectedCookies.length).toBe(0);
    });
  });

  describe("Invariant 8: Accurate Auth-Health Attribution (Rule 4)", () => {
    it("allows read:credentials callers to report operational health (active / invalid)", async () => {
      const authSession = await establishPortalAuthSession(
        broker,
        readOnlyAuth, // user with strictly ['read:credentials']
        "linkedin",
        mockBrowserContext as any
      );

      expect(authSession).not.toBeNull();
      // Operational observation reporting succeeds without manage:credentials
      await authSession!.reportHealth("invalid", "Session invalidated by remote portal");

      const cred = await store.getCredential(readOnlyAuth.tenantId, authSession!.credentialId);
      expect(cred?.status).toBe("invalid");

      // Can report active upon successful re-probe
      await authSession!.reportHealth("active");
      const credActive = await store.getCredential(readOnlyAuth.tenantId, authSession!.credentialId);
      expect(credActive?.status).toBe("active");
    });

    it("updates credential status to 'active' on authenticated session probe", async () => {
      const authSession = await establishPortalAuthSession(
        broker,
        tenantAAuth,
        "linkedin",
        mockBrowserContext as any
      );

      expect(authSession).not.toBeNull();
      await authSession!.reportHealth("active");

      const cred = await store.getCredential(tenantAAuth.tenantId, authSession!.credentialId);
      expect(cred?.status).toBe("active");
    });

    it("updates credential status to 'invalid' when explicit authwall is encountered", async () => {
      const authSession = await establishPortalAuthSession(
        broker,
        tenantAAuth,
        "linkedin",
        mockBrowserContext as any
      );

      expect(authSession).not.toBeNull();
      await authSession!.reportHealth("invalid", "Explicit authwall redirect");

      const cred = await store.getCredential(tenantAAuth.tenantId, authSession!.credentialId);
      expect(cred?.status).toBe("invalid");

      const auditLogs = await store.getAuditLogsForCredential(tenantAAuth.tenantId, authSession!.credentialId);
      const healthLog = auditLogs.find((l) => l.action === "invalidated" || l.action === "verified");
      expect(healthLog).toBeDefined();
    });

    it("prevents health reporting once session is disposed", async () => {
      const authSession = await establishPortalAuthSession(
        broker,
        tenantAAuth,
        "linkedin",
        mockBrowserContext as any
      );

      expect(authSession).not.toBeNull();
      authSession!.dispose();

      // Disposed session call should be a no-op
      await authSession!.reportHealth("invalid", "Post-dispose report");

      const cred = await store.getCredential(tenantAAuth.tenantId, authSession!.credentialId);
      expect(cred?.status).toBe("active"); // Remains active
    });

    it("rejects attempt by active session to resurrect a superseded (rotation_required) credential", async () => {
      // 1. Scraper leases v1
      const authSession = await establishPortalAuthSession(
        broker,
        tenantAAuth,
        "linkedin",
        mockBrowserContext as any
      );
      expect(authSession).not.toBeNull();
      const v1Id = authSession!.credentialId;

      // 2. Admin rotates credential to v2
      const v2 = await broker.rotateCredential(
        tenantAAuth,
        "linkedin",
        JSON.stringify({ li_at: "V2_NEW_SECRET" })
      );
      expect(v2.version).toBe(2);

      // Verify v1 is in rotation_required state
      const v1Cred = await store.getCredential(tenantAAuth.tenantId, v1Id);
      expect(v1Cred?.status).toBe("rotation_required");

      // 3. Old scraper session v1 attempts to reportHealth('active') -> MUST FAIL
      await expect(authSession!.reportHealth("active")).rejects.toThrow(CredentialLifecycleError);

      // Verify v1 was NOT resurrected
      const v1After = await store.getCredential(tenantAAuth.tenantId, v1Id);
      expect(v1After?.status).toBe("rotation_required");

      // 4. Old session reporting 'invalid' (e.g. shutting down) is legal
      await authSession!.reportHealth("invalid", "Session retiring old token");
      const v1Final = await store.getCredential(tenantAAuth.tenantId, v1Id);
      expect(v1Final?.status).toBe("invalid");
    });
  });

  describe("Invariant 9: Zero Credential Retention in PortalAuthSession", () => {
    it("verifies PortalAuthSession contains no plaintext secretPayload or secret properties", async () => {
      const authSession = await establishPortalAuthSession(
        broker,
        tenantAAuth,
        "linkedin",
        mockBrowserContext as any
      );

      expect(authSession).not.toBeNull();
      expect((authSession as any).secretPayload).toBeUndefined();
      expect((authSession as any).cookies).toBeUndefined();
      expect((authSession as any).headers).toBeUndefined();

      // Ensure JSON.stringify of authSession leaks no secrets
      const serialized = JSON.stringify(authSession);
      expect(serialized).not.toContain("SENTINEL_LI_AT_SECRET_123");
      expect(serialized).toContain("tenant_a");
      expect(serialized).toContain("linkedin");
    });

    it("relinquishes lease.secretPayload ownership in finally block even when browser injection fails", async () => {
      // Register a corrupt credential that passes decryption but fails injection parsing
      await broker.registerCredential(
        tenantAAuth,
        "indeed",
        JSON.stringify([{ name: "invalid cookie with \r\n control", value: "secret" }])
      );

      await expect(
        establishPortalAuthSession(
          broker,
          tenantAAuth,
          "indeed",
          mockBrowserContext as any
        )
      ).rejects.toThrow(CredentialPayloadError);

      // Verify zero browser mutations occurred
      expect(mockBrowserContext.injectedCookies.length).toBe(0);
      expect(Object.keys(mockBrowserContext.injectedHeaders).length).toBe(0);
    });
  });

  describe("Malicious Credential Payload & CR/LF Injection Suite", () => {
    it("rejects CR/LF injection attacks in HTTP header names and values", async () => {
      // CRLF in header key
      const badKeyPayload = JSON.stringify({
        headers: {
          "X-Custom\r\nInjected-Header": "value",
        },
      });
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(mockBrowserContext as any, "linkedin", badKeyPayload)
      ).rejects.toThrow(CredentialHeaderSecurityError);

      // CRLF in header value
      const badValuePayload = JSON.stringify({
        headers: {
          "X-Custom-Auth": "token123\r\nSet-Cookie: evil=1",
        },
      });
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(mockBrowserContext as any, "linkedin", badValuePayload)
      ).rejects.toThrow(CredentialHeaderSecurityError);
    });

    it("rejects control characters, delimiters, and malformed paths in cookie definitions", async () => {
      // Control char in cookie name
      const badCookieName = JSON.stringify([
        { name: "li\x00at", value: "valid_val", domain: ".linkedin.com" },
      ]);
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(mockBrowserContext as any, "linkedin", badCookieName)
      ).rejects.toThrow(CredentialPayloadError);

      // Semicolon / delimiter in cookie name
      const delimiterCookieName = JSON.stringify([
        { name: "li;at", value: "valid_val", domain: ".linkedin.com" },
      ]);
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(mockBrowserContext as any, "linkedin", delimiterCookieName)
      ).rejects.toThrow(CredentialPayloadError);

      // Control char in cookie value
      const badCookieValue = JSON.stringify([
        { name: "li_at", value: "val\r\nwith_crlf", domain: ".linkedin.com" },
      ]);
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(mockBrowserContext as any, "linkedin", badCookieValue)
      ).rejects.toThrow(CredentialPayloadError);

      // Malformed path not starting with /
      const badPath = JSON.stringify([
        { name: "li_at", value: "valid_val", domain: ".linkedin.com", path: "relative/path" },
      ]);
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(mockBrowserContext as any, "linkedin", badPath)
      ).rejects.toThrow(CredentialPayloadError);

      // Invalid negative expiry
      const badExpiry = JSON.stringify([
        { name: "li_at", value: "valid_val", domain: ".linkedin.com", expires: -100 },
      ]);
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(mockBrowserContext as any, "linkedin", badExpiry)
      ).rejects.toThrow(CredentialPayloadError);
    });

    it("rejects malicious array with evil domain", async () => {
      const payload = JSON.stringify([
        { name: "li_at", value: "SECRET", domain: ".evil.com" },
      ]);
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(mockBrowserContext as any, "linkedin", payload)
      ).rejects.toThrow(CredentialDomainSecurityError);
    });

    it("rejects malicious headers attempting cookie injection bypass", async () => {
      const payload = JSON.stringify({
        headers: {
          Cookie: "li_at=SECRET",
        },
      });
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(mockBrowserContext as any, "linkedin", payload)
      ).rejects.toThrow(CredentialHeaderSecurityError);
    });

    it("rejects malicious headers attempting Host override", async () => {
      const payload = JSON.stringify({
        headers: {
          Authorization: "Bearer SECRET",
          Host: "evil.com",
        },
      });
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(mockBrowserContext as any, "linkedin", payload)
      ).rejects.toThrow(CredentialHeaderSecurityError);
    });

    it("rejects cookie header string with cross-portal domain mismatch", async () => {
      // Trying to inject into an unsupported portal
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(
          mockBrowserContext as any,
          "unsupported_portal",
          "li_at=SECRET"
        )
      ).rejects.toThrow(CredentialDomainSecurityError);
    });

    it("rejects ambiguous payload mixing headers with unexpected keys", async () => {
      const payload = JSON.stringify({
        headers: { Authorization: "Bearer SECRET" },
        cookies: [{ name: "li_at", value: "SECRET" }],
      });
      await expect(
        PlaywrightCredentialInjector.injectIntoBrowserContext(mockBrowserContext as any, "linkedin", payload)
      ).rejects.toThrow(CredentialPayloadError);
    });
  });
});
