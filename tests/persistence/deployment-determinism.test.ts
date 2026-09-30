import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { getDatabaseAdapter, resetDatabaseAdapter } from "../../src/data/database/index";
import { getRepositories } from "../../src/data/sqlite/provider";
import { OpportunityService } from "@/opportunity/service";

describe("RADAR Stage 2C — Deployment Determinism & Production Invariants", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    resetDatabaseAdapter();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    resetDatabaseAdapter();
  });

  it("1. DatabaseAdapter fails fast in production when TURSO_CONNECTION_URL is missing", () => {
    process.env.RADAR_ENV = "production";
    process.env.NODE_ENV = "production";
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "dummy-token";

    expect(() => {
      getDatabaseAdapter();
    }).toThrow(
      /Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in production environment/,
    );
  });

  it("2. DatabaseAdapter fails fast in production when TURSO_AUTH_TOKEN is missing", () => {
    process.env.RADAR_ENV = "production";
    process.env.NODE_ENV = "production";
    process.env.TURSO_CONNECTION_URL = "libsql://radar-db.turso.io";
    process.env.TURSO_AUTH_TOKEN = "";

    expect(() => {
      getDatabaseAdapter();
    }).toThrow(
      /Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in production environment/,
    );
  });

  it("3. DatabaseAdapter in production NEVER falls back to better-sqlite3 or radar.sqlite", () => {
    process.env.RADAR_ENV = "production";
    process.env.NODE_ENV = "production";
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";

    try {
      getDatabaseAdapter();
      expect.fail("Should have thrown error in production");
    } catch (err: any) {
      expect(err.message).toContain(
        "Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in production environment",
      );
      expect(err.message).not.toContain("better-sqlite3");
    }
  });

  it("4. deploy.sh and legacy shell wrappers are removed; scripts/deploy.ts is the canonical deployment entrypoint", () => {
    expect(fs.existsSync(path.resolve(process.cwd(), "deploy.sh"))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), "remote_deploy.sh"))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), "scripts/deploy.ps1"))).toBe(false);
    expect(fs.existsSync(path.resolve(process.cwd(), "scripts/deploy.ts"))).toBe(true);
  });

  it("5. deploy.ts requires explicit target inputs, verified artifacts, and the supervised runtime topology", () => {
    const deployTsPath = path.resolve(process.cwd(), "scripts/deploy.ts");
    const content = fs.readFileSync(deployTsPath, "utf-8");

    expect(content).toContain("RADAR_DEPLOY_SSH_HOST");
    expect(content).toContain("RADAR_DEPLOY_SSH_KEY_PATH");
    expect(content).toContain("RADAR_DEPLOY_DB_FINGERPRINT");
    expect(content).toContain("verifyReleaseDirectory");
    expect(content).not.toContain("161.118.175.246");
    expect(content).not.toContain("oracle_official.key");
    expect(content).not.toContain("npm run build");
    expect(content).toContain("pm2 startOrRestart ecosystem.config.cjs --update-env");
    expect(content).toContain("allManagedWorkers");
    expect(content).toContain("workersStarted: true");
  });

  it("6. CI packages the certified release bundle rather than an ad-hoc server build", () => {
    const ci = fs.readFileSync(path.resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("npm run certify");
    expect(ci).toContain("npm run release:package");
    expect(ci).toContain("radar-release-${{ github.sha }}");
    expect(ci).not.toContain("radar-linux-output.tar.gz");
  });

  it("8. OpportunityService delegates serving queries exclusively to repos.canonicalServing and DatabaseAdapter", async () => {
    const servicePath = path.resolve(process.cwd(), "src/opportunity/service.ts");
    const serviceContent = fs.readFileSync(servicePath, "utf-8");

    // Static isolation: zero filesystem data artifacts
    expect(serviceContent).not.toContain("live-scraped.json");
    expect(serviceContent).not.toContain("radar.sqlite");
    expect(serviceContent).not.toContain("better-sqlite3");

    // Behavioral assertion: OpportunityService serving queries delegate to repos.canonicalServing
    const repos = getRepositories();
    const feedSpy = vi.spyOn(repos.canonicalServing, "getFeed").mockResolvedValueOnce({
      items: [],
      nextCursor: "",
      totalCount: 0,
      hasMore: false,
    });

    const mockScope = { tenantId: "tenant_test", personId: "user_test", roles: [] };
    const queries = (OpportunityService as any).getServingQueries();
    await queries.getFeed(mockScope);

    expect(feedSpy).toHaveBeenCalled();
    feedSpy.mockRestore();
  });

  it("9. SqliteOpportunityStore.listOpportunitySources queries DatabaseAdapter", () => {
    const repoPath = path.resolve(
      process.cwd(),
      "src/data/sqlite/repositories/SqliteOpportunityStore.ts",
    );
    const repoContent = fs.readFileSync(repoPath, "utf-8");

    expect(repoContent).toContain("SELECT o.id as id, o.canonical_title as canonical_title");
    expect(repoContent).toContain("FROM opportunities o");
    expect(repoContent).toContain("LEFT JOIN documents d ON d.opportunity_id = o.id");
    expect(repoContent).toContain("await this.db.many");
  });

  it("10. .env.example documents all required Turso and Google OAuth variables", () => {
    const envExamplePath = path.resolve(process.cwd(), ".env.example");
    const envContent = fs.readFileSync(envExamplePath, "utf-8");

    expect(envContent).toContain("TURSO_CONNECTION_URL=");
    expect(envContent).toContain("TURSO_AUTH_TOKEN=");
    expect(envContent).toContain("GOOGLE_CLIENT_ID=");
    expect(envContent).toContain("GOOGLE_CLIENT_SECRET=");
    expect(envContent).toContain("AUTH_SESSION_SECRET=");
  });
});
