import { describe, it, expect, beforeEach, afterEach } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import { getRequiredSchemaStatus, runMigrations, splitSqlStatements, verifyRequiredSchema } from "../../src/data/sqlite/migrations/runner";
import { getDatabaseAdapter, resetDatabaseAdapter } from "../../src/data/database";
import { setupLineageTestFixture } from "./lineage_fixture";
import { SqliteOpportunityQueries } from "../../src/data/sqlite/repositories/SqliteOpportunityQueries";

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
    expect(result.applied).toContain("039_backfill_v4_3_evaluation_fingerprint.sql");
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
      // This constructs an actual pre-037 database as test input. Production
      // runner invocations always verify the current required schema.
      await runMigrations(adapter, legacyDir, { verifyRequiredSchema: false });
      expect((await adapter.many<{ name: string }>("PRAGMA table_info(materialized_evaluations)")).map((column) => column.name)).not.toContain("evaluation_fingerprint");

      const upgraded = await runMigrations(adapter);
      expect(upgraded.applied).toContain("037_materialized_evaluation_fingerprint.sql");
      expect(upgraded.applied).toContain("038_opportunity_version_category_projection.sql");
      expect(await getRequiredSchemaStatus(adapter)).toEqual({
        evaluationFingerprintColumnPresent: true,
        categoryIdsColumnPresent: true,
      });

      // Run the actual canonical feed/metrics code path after upgrade rather
      // than merely preparing an ad-hoc SQL statement.
      await setupLineageTestFixture(adapter);
      await adapter.execute(`INSERT INTO users (id, email) VALUES ('person_A', 'a@a.com')`);
      await adapter.execute(`INSERT INTO memberships (user_id, tenant_id, role, permissions, status) VALUES ('person_A', 'tenant_A', 'admin', '["*"]', 'active')`);
      await adapter.execute(`INSERT INTO evaluation_context_scopes (context_fingerprint, tenant_id, person_id, search_plan_id) VALUES ('fingerprint_A', 'tenant_A', 'person_A', 'plan_A')`);
      await adapter.execute(`INSERT INTO active_evaluation_contexts (tenant_id, person_id, search_plan_id, context_fingerprint, activated_by) VALUES ('tenant_A', 'person_A', 'plan_A', 'fingerprint_A', 'person_A')`);
      const queries = new SqliteOpportunityQueries(adapter);
      await expect(queries.getFeed({ tenantId: "tenant_A", personId: "person_A" })).resolves.toMatchObject({ items: [] });
      await expect(queries.getMetrics({ tenantId: "tenant_A", personId: "person_A" })).resolves.toMatchObject({ totalScreened: 0 });
      expect((await runMigrations(adapter)).applied).toEqual([]);
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  });

  it("7. fails closed when the migration ledger claims 037 but its physical column is absent", async () => {
    const adapter = getDatabaseAdapter(":memory:");
    await adapter.execute("CREATE TABLE _migrations (id INTEGER PRIMARY KEY, migration_name TEXT UNIQUE)");
    await adapter.execute("CREATE TABLE materialized_evaluations (id TEXT PRIMARY KEY)");
    await adapter.execute("CREATE TABLE opportunity_versions (id TEXT PRIMARY KEY)");
    await adapter.execute("INSERT INTO _migrations (migration_name) VALUES ('037_materialized_evaluation_fingerprint.sql')");
    await expect(verifyRequiredSchema(adapter)).rejects.toThrow(/SCHEMA_DRIFT.*evaluation_fingerprint/i);
  });

  it("8. upgrades pre-039 canonical v4.3 artifacts by backfilling only their persisted evaluationInputHash", async () => {
    const migrationsDir = path.resolve(process.cwd(), "src/data/sqlite/migrations");
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-pre039-"));
    try {
      for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith(".sql") && name < "039_backfill_v4_3_evaluation_fingerprint.sql")) {
        fs.copyFileSync(path.join(migrationsDir, file), path.join(legacyDir, file));
      }
      const adapter = getDatabaseAdapter(":memory:");
      await runMigrations(adapter, legacyDir);
      await adapter.execute("PRAGMA foreign_keys = OFF");
      await adapter.execute(
        `INSERT INTO materialized_evaluations (
          id, tenant_id, person_id, canonical_job_id, opportunity_version,
          evaluation_context_fingerprint, evaluation_state, decision,
          quality_score, evaluation_json
        ) VALUES (?, ?, ?, ?, ?, ?, 'EVALUATED', 'PURSUE', 95, ?)`,
        [
          "eval-v43", "tenant-v43", "person-v43", "job-v43", "version-v43", "ctx-v43",
          JSON.stringify({
            schemaVersion: "v4.3-intrinsic",
            evaluationContractVersion: "v4.3",
            evaluationInputHash: "eval-v43-exact",
          }),
        ],
      );

      const upgraded = await runMigrations(adapter);
      expect(upgraded.applied).toContain("039_backfill_v4_3_evaluation_fingerprint.sql");
      await expect(adapter.one<{ evaluation_fingerprint: string }>(
        "SELECT evaluation_fingerprint FROM materialized_evaluations WHERE id = 'eval-v43'",
      )).resolves.toEqual({ evaluation_fingerprint: "eval-v43-exact" });
      expect((await runMigrations(adapter)).applied).toEqual([]);
    } finally {
      fs.rmSync(legacyDir, { recursive: true, force: true });
    }
  });
});
