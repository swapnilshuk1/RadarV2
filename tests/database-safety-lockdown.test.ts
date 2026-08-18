import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { getDatabaseAdapter, resetDatabaseAdapter, getRadarEnv } from "../src/data/database/index";

describe("RADAR V4 Phase 2A — Database Safety Lockdown", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    resetDatabaseAdapter();
  });

  afterEach(() => {
    process.env = { ...origEnv };
    resetDatabaseAdapter();
  });

  it("1. scripts/sync-to-turso.ts has been deleted", () => {
    const syncScriptPath = path.resolve(process.cwd(), "scripts/sync-to-turso.ts");
    expect(fs.existsSync(syncScriptPath)).toBe(false);
  });

  it("2. Dev environment fails fast without Turso credentials (zero radar.sqlite fallback)", () => {
    process.env.RADAR_ENV = "dev";
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";

    expect(() => {
      getDatabaseAdapter();
    }).toThrow(/Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in dev environment/);
  });

  it("3. Staging environment fails fast without Turso credentials", () => {
    process.env.RADAR_ENV = "staging";
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";

    expect(() => {
      getDatabaseAdapter();
    }).toThrow(/Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in staging environment/);
  });

  it("4. Production environment fails fast without Turso credentials", () => {
    process.env.RADAR_ENV = "production";
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_DATABASE_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";

    expect(() => {
      getDatabaseAdapter();
    }).toThrow(/Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN in production environment/);
  });

  it("5. Test environment allows explicit :memory: SQLite", async () => {
    process.env.RADAR_ENV = "test";
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";

    const adapter = getDatabaseAdapter(":memory:");
    expect(adapter).toBeDefined();

    await adapter.execute("CREATE TABLE _safety_test (id TEXT PRIMARY KEY, val TEXT)");
    await adapter.execute("INSERT INTO _safety_test (id, val) VALUES (?, ?)", ["k1", "v1"]);
    const row = await adapter.one<{ id: string; val: string }>("SELECT * FROM _safety_test WHERE id = ?", ["k1"]);
    expect(row).toEqual({ id: "k1", val: "v1" });
  });

  it("6. No-op dummy adapter is completely eliminated", () => {
    process.env.RADAR_ENV = "dev";
    process.env.TURSO_CONNECTION_URL = "";
    process.env.TURSO_AUTH_TOKEN = "";

    try {
      getDatabaseAdapter();
      expect.fail("Should have thrown error");
    } catch (err: any) {
      expect(err.message).toContain("Missing required TURSO_CONNECTION_URL or TURSO_AUTH_TOKEN");
      expect(err.message).not.toContain("no-op");
    }
  });

  it("7. getRadarEnv correctly parses RADAR_ENV and NODE_ENV", () => {
    process.env.RADAR_ENV = "staging";
    expect(getRadarEnv()).toBe("staging");

    delete process.env.RADAR_ENV;
    process.env.NODE_ENV = "production";
    expect(getRadarEnv()).toBe("production");

    process.env.NODE_ENV = "test";
    expect(getRadarEnv()).toBe("test");
  });
});
