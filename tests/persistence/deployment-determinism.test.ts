import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { getDatabaseAdapter, resetDatabaseAdapter } from "../../src/data/database/index";
import { getRepositories } from "../../src/data/sqlite/provider";
import { OpportunityService } from "../../src/lib/intelligence/opportunity-service";

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
    process.env.NODE_ENV = "production";
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "dummy-token";

    expect(() => {
      getDatabaseAdapter();
    }).toThrow(/Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in production environment/);
  });

  it("2. DatabaseAdapter fails fast in production when TURSO_AUTH_TOKEN is missing", () => {
    process.env.NODE_ENV = "production";
    process.env.TURSO_CONNECTION_URL = "libsql://radar-db.turso.io";
    process.env.TURSO_AUTH_TOKEN = "";

    expect(() => {
      getDatabaseAdapter();
    }).toThrow(/Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in production environment/);
  });

  it("3. DatabaseAdapter in production NEVER falls back to better-sqlite3 or radar.sqlite", () => {
    process.env.NODE_ENV = "production";
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";

    try {
      getDatabaseAdapter();
      expect.fail("Should have thrown error in production");
    } catch (err: any) {
      expect(err.message).toContain("Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in production environment");
      expect(err.message).not.toContain("better-sqlite3");
    }
  });

  it("4. deploy.sh targets canonical SSH key and Oracle server repository path", () => {
    const deployShPath = path.resolve(process.cwd(), "deploy.sh");
    const content = fs.readFileSync(deployShPath, "utf-8");

    // Must target oracle_official.key and remote repo directory
    expect(content).toContain("oracle_official.key");
    expect(content).toContain("130.210.41.232");
    expect(content).toContain("pm2 restart radar-v2");
  });

  it("5. deploy.ts targets canonical SSH key, build, and PM2 restart", () => {
    const deployTsPath = path.resolve(process.cwd(), "scripts/deploy.ts");
    const content = fs.readFileSync(deployTsPath, "utf-8");

    expect(content).toContain("oracle_official.key");
    expect(content).toContain("130.210.41.232");
    expect(content).toContain("pm2 restart radar-v2");
  });

  it("6. Deployment archive contains only required deterministic files", () => {
    const cwd = process.cwd();
    const tarArchive = path.join(cwd, "radar-deploy.tar.gz");

    // The certification runner builds first.  Never let a stale archive from
    // another SHA stand in for this run's production bundle.
    expect(fs.existsSync(path.join(cwd, ".output")), "Certification build output (.output/) is required before archive validation.").toBe(true);
    fs.rmSync(tarArchive, { force: true });

    try {
      const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
      if (fs.existsSync(gitBash)) {
        execSync(`"${gitBash}" -c "tar --exclude='node_modules' --exclude='.git' --exclude='.env*' --exclude='*.sqlite*' --exclude='*.jsonl' --exclude='*.log' --exclude='live-scraped.json' -czf radar-deploy.tar.gz .output/ package.json package-lock.json src/data/ontology/"`, { cwd });
      } else {
        execSync("tar --exclude='node_modules' --exclude='.git' --exclude='.env*' --exclude='*.sqlite*' --exclude='*.jsonl' --exclude='*.log' --exclude='live-scraped.json' -czf radar-deploy.tar.gz .output package.json package-lock.json src/data/ontology", { cwd });
      }

      expect(fs.existsSync(tarArchive), "Fresh deployment archive was not created.").toBe(true);
      const listOutput = execSync("tar -tf radar-deploy.tar.gz", { cwd, encoding: "utf8" });
      const files = listOutput.split("\n").map(f => f.trim()).filter(Boolean);

      // Required files present
      expect(files.some(f => f.includes(".output"))).toBe(true);
      expect(files.some(f => f.includes("package.json"))).toBe(true);
      expect(files.some(f => f.includes("src/data/ontology"))).toBe(true);

      // Forbidden files absent
      expect(files.some(f => f.includes("radar.sqlite"))).toBe(false);
      expect(files.some(f => f.includes("live-scraped.json"))).toBe(false);
      expect(files.some(f => f.includes(".env"))).toBe(false);
    } finally {
      fs.rmSync(tarArchive, { force: true });
    }
  });

  it("7. engine.ts contains zero direct reads from filesystem data artifacts", () => {
    const enginePath = path.resolve(process.cwd(), "src/lib/intelligence/engine.ts");
    const engineContent = fs.readFileSync(enginePath, "utf-8");

    expect(engineContent).not.toContain("radar.sqlite");
    expect(engineContent).not.toContain("live-scraped.json");
    expect(engineContent).not.toContain("better-sqlite3");
  });

  it("8. OpportunityService delegates serving queries exclusively to repos.canonicalServing and DatabaseAdapter", async () => {
    const servicePath = path.resolve(process.cwd(), "src/lib/intelligence/opportunity-service.ts");
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
    const repoPath = path.resolve(process.cwd(), "src/data/sqlite/repositories/SqliteOpportunityStore.ts");
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
