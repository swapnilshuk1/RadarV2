import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import { runMigrations, splitSqlStatements } from "../../src/data/sqlite/migrations/runner";
import { getDatabaseAdapter, resetDatabaseAdapter } from "../../src/data/database";

describe("Phase 2B: Migration Runner Canonical Infrastructure", () => {
  const originalRadarEnv = process.env.RADAR_ENV;
  const originalNodeEnv = process.env.NODE_ENV;
  const originalTursoUrl = process.env.TURSO_CONNECTION_URL;
  const originalTursoToken = process.env.TURSO_AUTH_TOKEN;

  beforeEach(() => {
    resetDatabaseAdapter();
    process.env.RADAR_ENV = "test";
    delete process.env.TURSO_CONNECTION_URL;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
  });

  afterEach(() => {
    resetDatabaseAdapter();
    if (originalRadarEnv) process.env.RADAR_ENV = originalRadarEnv;
    else delete process.env.RADAR_ENV;
    if (originalNodeEnv) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalTursoUrl) process.env.TURSO_CONNECTION_URL = originalTursoUrl;
    else delete process.env.TURSO_CONNECTION_URL;
    if (originalTursoToken) process.env.TURSO_AUTH_TOKEN = originalTursoToken;
    else delete process.env.TURSO_AUTH_TOKEN;
  });

  it("1. splitSqlStatements correctly parses SQL with comments and strings", () => {
    const sampleSql = `
      -- Line comment
      CREATE TABLE test_table (
        id TEXT PRIMARY KEY,
        description TEXT DEFAULT 'semicolon; in string',
        val INTEGER
      );
      /* Block comment with ; */
      CREATE INDEX idx_test_val ON test_table (val);
    `;

    const stmts = splitSqlStatements(sampleSql);
    expect(stmts.length).toBe(2);
    expect(stmts[0]).toContain("CREATE TABLE test_table");
    expect(stmts[0]).toContain("'semicolon; in string'");
    expect(stmts[1]).toContain("CREATE INDEX idx_test_val");
  });

  it("2. Executes migrations against an in-memory DatabaseAdapter", async () => {
    const inMemoryAdapter = getDatabaseAdapter(":memory:");
    const result = await runMigrations(inMemoryAdapter);

    expect(result.applied.length).toBeGreaterThan(0);
    expect(result.applied).toContain("001_initial_schema.sql");
    expect(result.applied).toContain("016_candidate_evaluations_and_jobs.sql");
    expect(result.applied).toContain("017_candidate_evaluations_v4_canonical.sql");

    // Verify tables exist in memory
    const tables = await inMemoryAdapter.many<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC"
    );
    const tableNames = tables.map((t) => t.name);

    expect(tableNames).toContain("_migrations");
    expect(tableNames).toContain("opportunities");
    expect(tableNames).toContain("decisions");
    expect(tableNames).toContain("candidate_evaluations");
    expect(tableNames).toContain("evaluation_jobs");

    const evaluationColumns = await inMemoryAdapter.many<{ name: string }>("PRAGMA table_info(materialized_evaluations)");
    const versionColumns = await inMemoryAdapter.many<{ name: string }>("PRAGMA table_info(opportunity_versions)");
    expect(evaluationColumns.map((column) => column.name)).toContain("evaluation_fingerprint");
    expect(versionColumns.map((column) => column.name)).toContain("category_ids");
    expect(result.applied).toContain("037_materialized_evaluation_fingerprint.sql");
    expect(result.applied).toContain("038_opportunity_version_category_projection.sql");
    await expect(inMemoryAdapter.many(
      `SELECT me.evaluation_fingerprint, ov.category_ids
       FROM opportunity_versions ov
       LEFT JOIN materialized_evaluations me ON me.opportunity_version = ov.id
       LIMIT 1`,
    )).resolves.toEqual([]);
  });

  it("3. Verifies migration ordering and bookkeeping", async () => {
    const inMemoryAdapter = getDatabaseAdapter(":memory:");
    const result = await runMigrations(inMemoryAdapter);

    // Bookkeeping table check
    const records = await inMemoryAdapter.many<{ migration_name: string }>(
      "SELECT migration_name FROM _migrations ORDER BY id ASC"
    );

    const recordedNames = records.map((r) => r.migration_name);
    expect(recordedNames).toEqual(result.applied);

    // Verify ordering is strictly ascending
    const sorted = [...recordedNames].sort();
    expect(recordedNames).toEqual(sorted);
  });

  it("4. Repeated migration execution is safe and idempotent", async () => {
    const inMemoryAdapter = getDatabaseAdapter(":memory:");

    // First run
    const run1 = await runMigrations(inMemoryAdapter);
    expect(run1.applied.length).toBeGreaterThan(0);

    // Second run
    const run2 = await runMigrations(inMemoryAdapter);
    expect(run2.applied.length).toBe(0);
    expect(run2.skipped.length).toBe(run1.applied.length);
  });

  it("5. Verifies zero filesystem SQLite files are created during migration run", async () => {
    const cwdRadarSqlite = path.resolve(process.cwd(), "radar.sqlite-test-check");
    if (fs.existsSync(cwdRadarSqlite)) {
      fs.unlinkSync(cwdRadarSqlite);
    }

    const inMemoryAdapter = getDatabaseAdapter(":memory:");
    await runMigrations(inMemoryAdapter);

    expect(fs.existsSync(cwdRadarSqlite)).toBe(false);
  });

  it("6. upgrades a pre-037 schema through 037/038 before canonical serving SQL runs", async () => {
    const migrationsDir = path.resolve(process.cwd(), "src/data/sqlite/migrations");
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-pre037-"));
    try {
      for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql") && name < "037_materialized_evaluation_fingerprint.sql")) {
        fs.copyFileSync(path.join(migrationsDir, file), path.join(legacyDir, file));
      }
      const adapter = getDatabaseAdapter(":memory:");
      await runMigrations(adapter, legacyDir);
      expect((await adapter.many<{ name: string }>("PRAGMA table_info(materialized_evaluations)")).map((column) => column.name)).not.toContain("evaluation_fingerprint");

      const upgraded = await runMigrations(adapter);
      expect(upgraded.applied).toContain("037_materialized_evaluation_fingerprint.sql");
      expect(upgraded.applied).toContain("038_opportunity_version_category_projection.sql");
      await expect(adapter.many(`SELECT me.evaluation_fingerprint, ov.category_ids FROM opportunity_versions ov LEFT JOIN materialized_evaluations me ON me.opportunity_version = ov.id LIMIT 1`)).resolves.toEqual([]);
      expect((await runMigrations(adapter)).applied).toEqual([]);
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});
