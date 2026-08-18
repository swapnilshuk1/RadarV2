import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { getDatabaseAdapter, resetDatabaseAdapter } from "../src/data/database/index";
import { runMigrations } from "../src/data/sqlite/migrations/runner";

describe("RADAR V4 Phase 2C — SQLite Retirement & Canonical Database Guarantee", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    resetDatabaseAdapter();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    resetDatabaseAdapter();
  });

  it("1. RADAR_ENV=production requires Turso credentials and fails fast", () => {
    process.env.RADAR_ENV = "production";
    delete process.env.NODE_ENV;
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";

    expect(() => getDatabaseAdapter()).toThrow(/Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN/);
  });

  it("2. RADAR_ENV=staging requires Turso credentials and fails fast", () => {
    process.env.RADAR_ENV = "staging";
    delete process.env.NODE_ENV;
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";

    expect(() => getDatabaseAdapter()).toThrow(/Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN/);
  });

  it("3. RADAR_ENV=dev requires Turso credentials and fails fast (no silent fallback)", () => {
    process.env.RADAR_ENV = "dev";
    delete process.env.NODE_ENV;
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";

    expect(() => getDatabaseAdapter()).toThrow(/Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in dev environment/);
  });

  it("4. RADAR_ENV=test instantiates isolated in-memory SQLite and never creates radar.sqlite", () => {
    process.env.RADAR_ENV = "test";
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";

    const radarSqlitePath = path.resolve(process.cwd(), "radar.sqlite");
    const wasPresent = fs.existsSync(radarSqlitePath);

    const adapter = getDatabaseAdapter(":memory:");
    expect(adapter).toBeDefined();

    // Verify radar.sqlite was not created on the filesystem
    if (!wasPresent) {
      expect(fs.existsSync(radarSqlitePath)).toBe(false);
    }
  });

  it("5. Migration runner executes idempotently against DatabaseAdapter in-memory", async () => {
    process.env.RADAR_ENV = "test";
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";
    const adapter = getDatabaseAdapter(":memory:");

    const res1 = await runMigrations(adapter);
    expect(res1.applied.length).toBeGreaterThanOrEqual(0);

    const res2 = await runMigrations(adapter);
    expect(res2.applied.length).toBe(0); // Idempotent second run
  });

  it("6. Obsolete scripts and read-models directory are completely deleted", () => {
    const deletedPaths = [
      "scripts/check-database-breakup.ts",
      "scripts/check-queue-status.ts",
      "scripts/rebuild-read-models.ts",
      "scripts/sync-to-turso.ts",
      "src/data/sqlite/read_models/CareerMemoryReadModel.ts",
      "src/data/sqlite/read_models/ExecutiveDashboardReadModel.ts",
      "src/data/sqlite/read_models/OpportunityInboxReadModel.ts",
      "src/data/sqlite/read_models/ReadModel.ts",
      "src/data/sqlite/read_models/ReadModelRebuilder.ts",
    ];

    for (const relPath of deletedPaths) {
      const fullPath = path.resolve(process.cwd(), relPath);
      expect(fs.existsSync(fullPath)).toBe(false);
    }
  });

  it("7. Application runtime repository/service layers contain zero direct instantiation of radar.sqlite", () => {
    const candidateDirs = [
      path.resolve(process.cwd(), "src/domain"),
      path.resolve(process.cwd(), "src/lib"),
      path.resolve(process.cwd(), "src/routes"),
      path.resolve(process.cwd(), "src/data/sqlite/repositories"),
    ];

    for (const dir of candidateDirs) {
      if (!fs.existsSync(dir)) continue;
      const list = fs.readdirSync(dir, { recursive: true }) as string[];
      for (const file of list) {
        if (typeof file === "string" && (file.endsWith(".ts") || file.endsWith(".tsx"))) {
          const full = path.join(dir, file);
          const content = fs.readFileSync(full, "utf-8");
          expect(content).not.toContain("radar.sqlite");
        }
      }
    }
  });
});
