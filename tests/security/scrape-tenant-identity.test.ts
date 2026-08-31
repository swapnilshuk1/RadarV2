import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { setupLineageTestFixture } from "../persistence/lineage_fixture";
import { resolveScraperAuthContext } from "../../src/lib/security/scope-resolver";
import { TenantIsolationError } from "../../src/lib/security/auth";
import { CredentialBroker } from "../../src/lib/security/CredentialBroker";
import { SqliteCredentialStore } from "../../src/data/sqlite/repositories/SqliteCredentialStore";

describe("Checkpoint B: Canonical Scraper Identity and Tenant Isolation Contract", () => {
  let sqliteDb: Database.Database;
  let db: SqliteAdapter;
  let credentialStore: SqliteCredentialStore;
  let broker: CredentialBroker;

  beforeEach(async () => {
    sqliteDb = new Database(":memory:");
    db = new SqliteAdapter(sqliteDb);
    await setupLineageTestFixture(db);

    credentialStore = new SqliteCredentialStore(db);
    broker = new CredentialBroker(credentialStore);

    // Seed tenants
    await db.execute(`INSERT OR IGNORE INTO tenants (id, status) VALUES ('tenant_alpha', 'active'), ('tenant_beta', 'active')`);
    
    // Seed users and people
    await db.execute(`INSERT OR IGNORE INTO users (id, email) VALUES ('user_admin', 'admin@alpha.com'), ('user_scraper', 'scraper@alpha.com'), ('user_viewer', 'viewer@alpha.com'), ('user_beta', 'beta@beta.com')`);
    await db.execute(`INSERT OR IGNORE INTO people (id, email, tenant_id) VALUES ('user_admin', 'admin@alpha.com', 'tenant_alpha'), ('user_scraper', 'scraper@alpha.com', 'tenant_alpha'), ('user_viewer', 'viewer@alpha.com', 'tenant_alpha'), ('user_beta', 'beta@beta.com', 'tenant_beta')`);

    // Seed memberships with explicit RBAC
    await db.execute(`
      INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, permissions, status)
      VALUES 
        ('user_admin', 'tenant_alpha', 'admin', '["run:scraper", "manage:credentials", "read:credentials", "manage:search_plan"]', 'active'),
        ('user_scraper', 'tenant_alpha', 'member', '["run:scraper", "read:credentials"]', 'active'),
        ('user_viewer', 'tenant_alpha', 'viewer', '["read:evaluation"]', 'active'),
        ('user_beta', 'tenant_beta', 'admin', '["run:scraper", "manage:credentials", "read:credentials"]', 'active')
    `);
  });

  it("Invariant 1: Rejects user without tenant membership from acquiring scraper context", async () => {
    await expect(resolveScraperAuthContext("non_existent_user", "tenant_alpha", db)).rejects.toThrow(TenantIsolationError);
  });

  it("Invariant 2: Rejects user lacking 'run:scraper' permission from acquiring scraper context", async () => {
    await expect(resolveScraperAuthContext("user_viewer", "tenant_alpha", db)).rejects.toThrow(TenantIsolationError);
  });

  it("Invariant 3: Authorizes admin user with complete verified tenant scope and scraper permissions", async () => {
    const res = await resolveScraperAuthContext("user_admin", "tenant_alpha", db);
    expect(res.authContext.tenantId).toBe("tenant_alpha");
    expect(res.authContext.userId).toBe("user_admin");
    expect(res.authContext.permissions.includes("run:scraper")).toBe(true);
    expect(res.authContext.permissions.includes("manage:credentials")).toBe(true);
    expect(res.scope.tenantId).toBe("tenant_alpha");
    expect(res.scope.personId).toBe("user_admin");
  });

  it("Invariant 4: Authorizes member with explicit 'run:scraper' permission", async () => {
    const res = await resolveScraperAuthContext("user_scraper", "tenant_alpha", db);
    expect(res.authContext.tenantId).toBe("tenant_alpha");
    expect(res.authContext.userId).toBe("user_scraper");
    expect(res.authContext.permissions.includes("run:scraper")).toBe(true);
    expect(res.authContext.permissions.includes("read:credentials")).toBe(true);
    expect(res.authContext.permissions.includes("manage:credentials")).toBe(false);
  });

  it("Invariant 5: Cross-tenant credential access is strictly prohibited", async () => {
    // Tenant Beta registers a secret credential
    const betaAuth = {
      tenantId: "tenant_beta",
      userId: "user_beta",
      permissions: ["manage:credentials", "read:credentials"] as any,
    };
    await broker.registerCredential(betaAuth, "naukri", "beta_secret_token_12345");

    // Tenant Alpha attempts to lease Tenant Beta's credential
    const alphaAuth = {
      tenantId: "tenant_alpha",
      userId: "user_scraper",
      permissions: ["read:credentials"] as any,
    };

    // Should throw CredentialNotFoundError because Tenant Alpha has no credentials registered for naukri
    const { CredentialNotFoundError } = await import("../../src/lib/security/CredentialBroker");
    await expect(broker.leaseCredential(alphaAuth, "naukri")).rejects.toThrow(CredentialNotFoundError);
  });

  it("Invariant 6: Zero 'default_tenant' or fabricated permissions in scraper server or runner code", () => {
    const scrapeServerPath = path.resolve(process.cwd(), "src/lib/intelligence/scrape-server.ts");
    const scrapeServerCode = fs.readFileSync(scrapeServerPath, "utf-8");

    // Must not contain default_tenant fallback
    expect(scrapeServerCode.includes('"default_tenant"')).toBe(false);
    expect(scrapeServerCode.includes("'default_tenant'")).toBe(false);
    expect(scrapeServerCode.includes("(user as any).tenantId")).toBe(false);

    const scrapeRunnerPath = path.resolve(process.cwd(), "scripts/scrape.ts");
    const scrapeRunnerCode = fs.readFileSync(scrapeRunnerPath, "utf-8");

    // Scrape runner must not default to default_tenant
    expect(scrapeRunnerCode.includes('tenantId: "default_tenant"')).toBe(false);
    expect(scrapeRunnerCode.includes("tenantId: 'default_tenant'")).toBe(false);
  });

  it("Invariant 7: Zero temporary profile files or writes to search-plan.json in profile server", () => {
    const profileServerPath = path.resolve(process.cwd(), "src/lib/intelligence/profile-server.ts");
    const profileServerCode = fs.readFileSync(profileServerPath, "utf-8");

    expect(profileServerCode.includes("temp-profile-")).toBe(false);
    expect(profileServerCode.includes("src/data/search-plan.json")).toBe(false);
    expect(profileServerCode.includes("fs.writeFileSync(searchPlanOutputPath")).toBe(false);
  });
});
