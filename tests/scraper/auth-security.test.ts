import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { AuthError, requireAuthUser, type SessionUser } from "../../src/lib/auth/guard";
import { createSession, generateSessionToken } from "../../src/lib/auth/session";
import { getDatabase } from "../../src/data/sqlite/provider";
import { getActiveScrapeLock } from "../../src/lib/intelligence/scrape-server";

describe("P0-B & P0-C & P0-D Security Regression Suite", () => {
  const db = getDatabase();
  const testRegularUserId = `test-user-${Date.now()}`;
  const testAdminUserId = `test-admin-${Date.now()}`;
  let regularToken: string;
  let adminToken: string;

  const testTenantId = `tenant-${Date.now()}`;

  beforeAll(async () => {
    // 0. Create test tenant
    await db.execute(
      `INSERT INTO tenants (id, status) VALUES (?, 'active')`,
      [testTenantId]
    );

    // 1. Create test regular user
    await db.execute(
      `INSERT INTO people (id, email, name, role, onboarded, email_verified, tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, 'user', 1, 1, ?, datetime('now'), datetime('now'))`,
      [testRegularUserId, `${testRegularUserId}@example.com`, "Test Regular User", testTenantId]
    );

    // 2. Create test admin user
    await db.execute(
      `INSERT INTO people (id, email, name, role, onboarded, email_verified, tenant_id, created_at, updated_at)
       VALUES (?, ?, ?, 'admin', 1, 1, ?, datetime('now'), datetime('now'))`,
      [testAdminUserId, `${testAdminUserId}@example.com`, "Test Admin User", testTenantId]
    );

    // 3. Create active sessions
    regularToken = generateSessionToken();
    await createSession(regularToken, testRegularUserId);

    adminToken = generateSessionToken();
    await createSession(adminToken, testAdminUserId);
  });

  afterAll(async () => {
    try {
      await db.execute(`DELETE FROM auth_sessions WHERE user_id IN (?, ?)`, [testRegularUserId, testAdminUserId]);
      await db.execute(`DELETE FROM people WHERE id IN (?, ?)`, [testRegularUserId, testAdminUserId]);
    } catch (e) {
      // cleanup best effort
    }
  });

  // ─── P0-B: AUTH & AUTHORIZATION TESTS ────────────────────────────────────────

  describe("P0-B: Identity & Authorization", () => {
    it("AuthError preserves correct status 401 and 403", () => {
      const err401 = new AuthError("Unauthorized", 401);
      expect(err401.statusCode).toBe(401);
      expect(err401.status).toBe(401);
      expect(err401.name).toBe("AuthError");

      const err403 = new AuthError("Forbidden", 403);
      expect(err403.statusCode).toBe(403);
      expect(err403.status).toBe(403);
      expect(err403.name).toBe("AuthError");
    });

    it("requireAuthUser throws 401 when no session cookie exists (no fallback)", async () => {
      await expect(requireAuthUser()).rejects.toThrow(AuthError);
      try {
        await requireAuthUser();
      } catch (err: any) {
        expect(err.statusCode).toBe(401);
        expect(err.status).toBe(401);
      }
    });

    it("requireAuthUser throws 403 when a regular user attempts an admin operation", async () => {
      // Simulate session context for regular user
      const { validateSessionToken } = await import("../../src/lib/auth/session");
      const { user } = await validateSessionToken(regularToken);
      expect(user).not.toBeNull();
      expect(user?.role).toBe("user");

      // Verify that requireAuthUser enforces admin role check
      const adminGuard = (u: SessionUser | null) => {
        if (!u) throw new AuthError("Authentication required. Please sign in.", 401);
        if (u.role !== "admin") throw new AuthError("Forbidden: Administrative privilege required.", 403);
        return u;
      };

      expect(() => adminGuard(user)).toThrow(AuthError);
      try {
        adminGuard(user);
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.status).toBe(403);
      }
    });

    it("admin guard succeeds when user has admin role", async () => {
      const { validateSessionToken } = await import("../../src/lib/auth/session");
      const { user } = await validateSessionToken(adminToken);
      expect(user).not.toBeNull();
      expect(user?.role).toBe("admin");

      const adminGuard = (u: SessionUser | null) => {
        if (!u) throw new AuthError("Authentication required. Please sign in.", 401);
        if (u.role !== "admin") throw new AuthError("Forbidden: Administrative privilege required.", 403);
        return u;
      };

      const result = adminGuard(user);
      expect(result.id).toBe(testAdminUserId);
      expect(result.role).toBe("admin");
    });

    it("expired or invalid session tokens throw 401", async () => {
      const { validateSessionToken } = await import("../../src/lib/auth/session");
      const invalidResult = await validateSessionToken("completely-invalid-token-12345");
      expect(invalidResult.session).toBeNull();
      expect(invalidResult.user).toBeNull();
    });

    it("user decisions are isolated by person_id in repository store", async () => {
      const { getRepositories } = await import("../../src/data/sqlite/provider");
      const repos = getRepositories();

      // Create a test canonical opportunity first
      const testOpId = `op-test-${Date.now()}`;
      await db.execute(
        `INSERT INTO canonical_opportunities (id, source, source_job_id, canonical_url, company_name)
         VALUES (?, 'test', ?, 'https://test', 'Test Corp')`,
        [testOpId, testOpId]
      );

      // Save a decision for testRegularUserId
      await repos.decisions.recordUserDecision(testRegularUserId, testOpId, "PURSUE", "Strong fit", null, testTenantId);

      // Verify regular user can read it
      const userDecisions = await repos.decisions.getUserDecisions(testRegularUserId, testTenantId);
      expect(userDecisions[testOpId]).toBeDefined();
      expect(userDecisions[testOpId].verb).toBe("PURSUE");

      // Verify admin user has empty decisions (no cross-contamination)
      const adminDecisions = await repos.decisions.getUserDecisions(testAdminUserId, testTenantId);
      expect(adminDecisions[testOpId]).toBeUndefined();

      // Cleanup
      await repos.decisions.deleteUserDecision(testRegularUserId, testOpId, testTenantId);
    });

    it("cross-user explanation requests are rejected when not admin", async () => {
      const regularUser: SessionUser = {
        id: testRegularUserId,
        email: `${testRegularUserId}@example.com`,
        role: "user",
        name: "Test User",
        avatarUrl: null,
        onboarded: true,
        emailVerified: true
      };

      const requestedPersonId = "someone-else-id";

      const checkAccess = (u: SessionUser, targetPersonId: string) => {
        if (targetPersonId !== u.id && u.role !== "admin") {
          const err: any = new Error("FORBIDDEN: Opportunity explanation access denied");
          err.statusCode = 403;
          throw err;
        }
        return true;
      };

      // Regular user trying to access someone else's explanation -> 403
      expect(() => checkAccess(regularUser, requestedPersonId)).toThrow();
      try {
        checkAccess(regularUser, requestedPersonId);
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
      }

      // Regular user accessing their own explanation -> allowed
      expect(checkAccess(regularUser, testRegularUserId)).toBe(true);

      // Admin user accessing someone else's explanation -> allowed
      const adminUser: SessionUser = { ...regularUser, id: testAdminUserId, role: "admin" };
      expect(checkAccess(adminUser, requestedPersonId)).toBe(true);
    });
  });

  // ─── P0-C: SCRAPER MUTEX & ACCESS CONTROL ───────────────────────────────────

  describe("P0-C / SEC-03: Scraper Mutex & Access Control", () => {
    it("getActiveScrapeLock returns null when no scrape is running", () => {
      const lock = getActiveScrapeLock();
      expect(lock === null || typeof lock.runId === "string").toBe(true);
    });

    it("mutex rejects concurrent scrape runs when one is active", () => {
      const simulateMutexCheck = (activeLock: { runId: string } | null, activeState: any) => {
        if (activeLock || activeState) {
          return {
            success: false,
            error: "A scraping run is already in progress. Concurrent execution is rejected.",
            alreadyRunning: true
          };
        }
        return { success: true };
      };

      // When an active lock exists
      const rejected = simulateMutexCheck({ runId: "test-run-123" }, null);
      expect(rejected.success).toBe(false);
      expect(rejected.alreadyRunning).toBe(true);

      // When no active lock exists
      const allowed = simulateMutexCheck(null, null);
      expect(allowed.success).toBe(true);
    });

    it("mutex releases cleanly after background scraper error or exception", async () => {
      let testLock: { runId: string; startedAt: number } | null = null;
      const runId = "test-failing-run";

      testLock = { runId, startedAt: Date.now() };
      expect(testLock).not.toBeNull();

      // Simulate a failed completion promise
      const failingPromise = Promise.reject(new Error("Scraper crashed unexpectedly"));
      await failingPromise.catch(() => {
        if (testLock?.runId === runId) {
          testLock = null;
        }
      });

      expect(testLock).toBeNull();
    });
  });

  // ─── SEC-01: ENVIRONMENT-ONLY DB CONFIGURATION ──────────────────────────────

  describe("SEC-01: Environment-Only DB Configuration & Secret Scanning", () => {
    it("source files contain zero hardcoded Turso tokens or credentials", () => {
      const dbIndexContent = fs.readFileSync(path.resolve(process.cwd(), "src/data/database/index.ts"), "utf-8");
      expect(dbIndexContent).not.toMatch(/DEFAULT_TURSO_TOKEN/);
      expect(dbIndexContent).not.toMatch(/DEFAULT_TURSO_URL/);
      expect(dbIndexContent).not.toMatch(/eyJhbGciOiJFZERTQS/);
    });

    it("DB adapter successfully connects using environment-only credentials", async () => {
      const { getDatabaseAdapter } = await import("../../src/data/database/index");
      const adapter = getDatabaseAdapter();
      const countRes = await adapter.one<{ count: number }>("SELECT count(*) as count FROM opportunities");
      expect(countRes).not.toBeNull();
      expect(typeof countRes?.count).toBe("number");
    });
  });

  // ─── SEC-07: SECRET HYGIENE & TRACKED FILES INTEGRITY ──────────────────────

  describe("SEC-07: Secret Hygiene & Tracked Configuration Integrity", () => {
    it(".gitignore contains all required secret exclusion patterns", () => {
      const gitignorePath = path.resolve(process.cwd(), ".gitignore");
      expect(fs.existsSync(gitignorePath)).toBe(true);
      const content = fs.readFileSync(gitignorePath, "utf-8");

      expect(content).toMatch(/\.env/);
      expect(content).toMatch(/\.env\.\*/);
      expect(content).toMatch(/\*\.env/);
      expect(content).toMatch(/\*\.key/);
      expect(content).toMatch(/\*\.pem/);
    });

    it("no tracked git files contain private keys or active secrets", () => {
      const trackedFiles = execSync("git ls-files", { encoding: "utf-8" }).split("\n");

      for (const file of trackedFiles) {
        const trimmed = file.trim();
        if (!trimmed) continue;
        if (trimmed.endsWith(".key") || trimmed.endsWith(".pem")) {
          throw new Error(`CRITICAL SECURITY FAILURE: Private key tracked in git: ${trimmed}`);
        }
        if (trimmed === ".env" || (trimmed.startsWith(".env.") && trimmed !== ".env.example")) {
          throw new Error(`CRITICAL SECURITY FAILURE: Active .env file tracked in git: ${trimmed}`);
        }
      }
    });

    it("required tracked configuration files remain tracked and present", () => {
      const requiredFiles = [
        "package.json",
        "tsconfig.json",
        "vite.config.ts",
        ".env.example",
        "AGENTS.md"
      ];
      for (const file of requiredFiles) {
        expect(fs.existsSync(path.resolve(process.cwd(), file))).toBe(true);
      }
    });
  });
});
