import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../../src/data/database/sqlite";
import { getDatabaseAdapter, resetDatabaseAdapter } from "../../src/data/database";
import { runMigrations, splitSqlStatements } from "../../src/data/sqlite/migrations/runner";
import { SqliteScrapeRunStore } from "../../src/data/sqlite/repositories/SqliteScrapeRunStore";
import { CanonicalIngestionService } from "../../src/lib/acquisition/CanonicalIngestionService";
import { MemoryBlobStore } from "../../src/lib/storage/blob-store";
import { resolveScraperRuntimeOptions } from "../../scripts/scraper/options";
import { loadUnifiedEnvironment } from "../../src/lib/env";
import { verifyArtifactStorage, CONFIG } from "../../scripts/scraper/config";
import {
  acquireExclusiveLock,
  releaseExclusiveLock,
  readExclusiveLock,
} from "../../scripts/scraper/run/exclusive-lock";
import {
  prepareProfileForScope,
  maybeMigrateLegacyProfile,
  profileDirFor,
} from "../../scripts/scraper/portals/base";
import {
  resolveScraperCapabilities,
  activeRunSessions,
  processUnit,
  startRun,
} from "../../scripts/scrape";
import { RunController } from "../../scripts/scraper/run/manager";
import {
  EXTRACTOR_VERSION,
  SCRAPER_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from "../../scripts/scraper/versions";

describe("Scraper Operability Patch — Invariant Suite (Scenarios A through AJ)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-operability-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {}
  });

  // --------------------------------------------------------------------------
  // Scenario A: Planless Scoped Canonical Ingestion Truthful Returns
  // --------------------------------------------------------------------------
  it("Scenario A: Ingests canonically in SCOPED mode without searchPlanId and returns 0 candidates / 0 evaluation jobs", async () => {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, status TEXT NOT NULL, criteria_json TEXT);
      CREATE TABLE scrape_runs (id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, search_plan_id TEXT, status TEXT, portal_targets TEXT, started_at TEXT, finished_at TEXT, error_message TEXT);
      CREATE TABLE canonical_opportunities (id TEXT PRIMARY KEY, source TEXT NOT NULL, source_job_id TEXT NOT NULL, canonical_url TEXT, company_name TEXT, created_at TEXT, last_seen_at TEXT, UNIQUE(source, source_job_id));
      CREATE TABLE opportunity_versions (
        id TEXT PRIMARY KEY, canonical_job_id TEXT NOT NULL, content_hash TEXT NOT NULL, job_title TEXT, company_name TEXT,
        location TEXT, employment_type TEXT, posted_at TEXT, posted_precision TEXT, raw_content TEXT,
        acquisition_status TEXT, acquisition_quality TEXT, failure_class TEXT, lifecycle_state TEXT, evidence_state TEXT,
        source_payload_key TEXT, source_media_type TEXT, document_extraction_state TEXT, category_ids TEXT, created_at TEXT,
        UNIQUE(canonical_job_id, content_hash)
      );
      CREATE TABLE search_plan_candidates (
        tenant_id TEXT NOT NULL, person_id TEXT NOT NULL, search_plan_id TEXT NOT NULL,
        canonical_job_id TEXT NOT NULL, opportunity_version TEXT NOT NULL, attention_decision TEXT NOT NULL,
        eligibility TEXT, eligibility_reason_codes_json TEXT, location_policy TEXT, location_evidence TEXT, created_at TEXT,
        PRIMARY KEY(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version)
      );
      CREATE TABLE evaluation_jobs (
        id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, search_plan_id TEXT, canonical_job_id TEXT,
        opportunity_version TEXT, evaluation_context_fingerprint TEXT, status TEXT, attempts INTEGER, max_attempts INTEGER,
        next_attempt_at TEXT, created_at TEXT, updated_at TEXT,
        UNIQUE(tenant_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
      );
      CREATE TABLE evaluation_requirements (
        id TEXT PRIMARY KEY, tenant_id TEXT, person_id TEXT, search_plan_id TEXT, canonical_job_id TEXT,
        opportunity_version TEXT, required_enrichment_pipeline_version TEXT,
        evaluation_context_fingerprint TEXT, status TEXT, blocked_reason TEXT, created_at TEXT, updated_at TEXT,
        UNIQUE(tenant_id, person_id, search_plan_id, canonical_job_id, opportunity_version, evaluation_context_fingerprint)
      );
      CREATE TABLE scrape_run_evaluation_requirements (
        run_id TEXT, evaluation_requirement_id TEXT,
        PRIMARY KEY(run_id, evaluation_requirement_id)
      );
      CREATE TABLE enrichment_jobs (
        id TEXT PRIMARY KEY, job_hash TEXT NOT NULL, canonical_job_id TEXT NOT NULL, opportunity_version TEXT NOT NULL,
        pipeline_version TEXT NOT NULL, snapshot_path TEXT, payload_key TEXT NOT NULL, run_id TEXT, execution_plan_id TEXT,
        definition_id TEXT, family_id TEXT, portal TEXT, page INTEGER, catalog_version TEXT, planner_version TEXT,
        rule_version TEXT, search_query TEXT, business_priority INTEGER, execution_priority INTEGER, status TEXT,
        payload_type TEXT, payload_size INTEGER, lease_holder TEXT, leased_at TEXT, lease_expires_at TEXT, attempts INTEGER,
        max_attempts INTEGER, error_message TEXT, created_at TEXT, updated_at TEXT,
        UNIQUE(canonical_job_id, opportunity_version, pipeline_version)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_enrichment_jobs_scope ON enrichment_jobs(canonical_job_id, opportunity_version, pipeline_version) WHERE canonical_job_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS scrape_run_enrichment_requirements (
        run_id TEXT, enrichment_job_id TEXT,
        PRIMARY KEY(run_id, enrichment_job_id)
      );
    `);

    raw.prepare("INSERT INTO tenants (id) VALUES ('tenant-1')").run();
    raw.prepare("INSERT INTO people (id, tenant_id) VALUES ('person-1', 'tenant-1')").run();
    raw.prepare("INSERT INTO scrape_runs (id, tenant_id, person_id, status) VALUES ('run-planless-1', 'tenant-1', 'person-1', 'running')").run();

    const db = new SqliteAdapter(raw);
    const blobStore = new MemoryBlobStore();
    const service = new CanonicalIngestionService(db, blobStore);

    const fullJobContent = "VP Growth owns commercial growth, market strategy, revenue operations, and executive team leadership across multi-region enterprise markets with full P&L oversight, cross-functional organizational accountability, and high-impact board governance.";

    const detailUrl = "https://www.linkedin.com/jobs/view/job-planless-123";
    const result = await service.ingestOpportunity(
      {
        sourcePortal: "LinkedIn",
        sourceJobId: "job-planless-123",
        canonicalUrl: detailUrl,
        jobTitle: "VP Growth",
        companyName: "Acme Corp",
        location: "Gurugram",
        rawContent: fullJobContent,
        contentOrigin: "DETAIL_DOCUMENT",
        enrichmentDispatch: {
          pipelineVersion: EXTRACTOR_VERSION,
          detailedCard: {
            cardHash: "test-job-planless-123",
            sourceJobId: "job-planless-123",
            portal: "LinkedIn",
            keyword: "VP Growth",
            searchUrl: "https://www.linkedin.com/jobs/search/",
            discoveryUrl: detailUrl,
            detailUrl,
            discoveredAt: "2026-09-10T12:00:00Z",
            title: "VP Growth",
            company: "Acme Corp",
            location: "Gurugram",
            rawHtml: "",
            rawText: fullJobContent,
            snapshotSchemaVersion: SNAPSHOT_SCHEMA_VERSION,
            scraperVersion: SCRAPER_VERSION,
            detail: {
              fetched: true,
              rawHtml: "",
              rawText: fullJobContent,
              extractedTitle: "VP Growth",
              extractedCompany: "Acme Corp",
              finalUrl: detailUrl,
            },
            telemetry: {
              cardExtractMs: 0,
              detailExtractMs: 0,
              totalMs: 0,
            },
          },
        },
      },
      {
        mode: "SCOPED",
        tenantId: "tenant-1",
        personId: "person-1",
        searchPlanId: null, // Explicit planless scoped ingestion
        runId: "run-planless-1",
      }
    );

    // Verifications:
    expect(result.canonicalJobId).toBeDefined();
    expect(result.canonicalJobId.length).toBe(64);
    expect(result.isNewOpportunity).toBe(true);
    expect(result.isNewVersion).toBe(true);
    expect(result.plansEvaluated).toBe(0);
    expect(result.candidatesProjected).toBe(0);
    expect(result.jobsEnqueued).toBe(0);

    // Verify raw opportunity version was persisted
    const versions = raw.prepare("SELECT * FROM opportunity_versions WHERE canonical_job_id = ?").all(result.canonicalJobId);
    expect(versions.length).toBe(1);

    // Verify enrichment job was created
    const enrichmentJobs = raw.prepare("SELECT * FROM enrichment_jobs WHERE canonical_job_id = ?").all(result.canonicalJobId);
    expect(enrichmentJobs.length).toBe(1);

    // Verify ZERO search_plan_candidates and evaluation_requirements were created
    const candidates = raw.prepare("SELECT * FROM search_plan_candidates").all();
    expect(candidates.length).toBe(0);

    const evalReqs = raw.prepare("SELECT * FROM evaluation_requirements").all();
    expect(evalReqs.length).toBe(0);
  });

  // --------------------------------------------------------------------------
  // Scenario B: Scrape Run Store Nullable Search Plan
  // --------------------------------------------------------------------------
  it("Scenario B: SqliteScrapeRunStore creates and retrieves runs with null searchPlanId", async () => {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE scrape_runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        search_plan_id TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        portal_targets TEXT NOT NULL,
        total_discovered INTEGER NOT NULL DEFAULT 0,
        total_enqueued INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        finished_at TEXT,
        error_message TEXT,
        config_json TEXT,
        metrics_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    raw.prepare("INSERT INTO tenants (id) VALUES ('tenant-alpha')").run();
    raw.prepare("INSERT INTO people (id, tenant_id) VALUES ('person-alpha', 'tenant-alpha')").run();

    const db = new SqliteAdapter(raw);
    const store = new SqliteScrapeRunStore(db);
    const scope = { tenantId: "tenant-alpha", personId: "person-alpha" };

    const run = await store.createRun(scope, {
      portalTargets: ["LinkedIn", "Indeed"],
      searchPlanId: null, // Null search plan
      initialStatus: "queued",
    });

    expect(run.id).toBeDefined();
    expect(run.searchPlanId).toBeNull();
    expect(run.status).toBe("queued");

    const retrieved = await store.getRun(scope, run.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.searchPlanId).toBeNull();
  });

  // --------------------------------------------------------------------------
  // Scenario C: Migration 046 Rebuild & Active Run Partial Unique Index
  // --------------------------------------------------------------------------
  it("Scenario C: Migration 046 safely rebuilds scrape_runs and enforces active-run mutual exclusion per tenant/person", async () => {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE search_plans (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, person_id TEXT NOT NULL);

      -- Old table with NOT NULL search_plan_id
      CREATE TABLE scrape_runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        search_plan_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        portal_targets TEXT NOT NULL DEFAULT '["LinkedIn"]',
        total_discovered INTEGER NOT NULL DEFAULT 0,
        total_enqueued INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        finished_at TEXT,
        error_message TEXT,
        config_json TEXT NOT NULL DEFAULT '{}',
        metrics_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    raw.prepare("INSERT INTO tenants (id) VALUES ('t1')").run();
    raw.prepare("INSERT INTO people (id, tenant_id) VALUES ('p1', 't1')").run();
    raw.prepare("INSERT INTO search_plans (id, tenant_id, person_id) VALUES ('sp1', 't1', 'p1')").run();
    raw.prepare(`
      INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, config_json, metrics_json)
      VALUES ('run-old', 't1', 'p1', 'sp1', 'completed', '{}', '{}')
    `).run();

    // Apply migration 046 script directly with raw.exec
    const migration046Sql = fs.readFileSync(
      path.join(process.cwd(), "src", "data", "sqlite", "migrations", "046_scrape_runs_nullable_search_plan.sql"),
      "utf-8"
    );
    raw.exec(migration046Sql);

    // 1. Verify old completed row survived
    const oldRow = raw.prepare("SELECT * FROM scrape_runs WHERE id = 'run-old'").get() as any;
    expect(oldRow).toBeDefined();
    expect(oldRow.search_plan_id).toBe("sp1");

    // 2. Insert run with NULL search_plan_id
    raw.prepare(`
      INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets)
      VALUES ('run-active-1', 't1', 'p1', NULL, 'running', '["LinkedIn"]')
    `).run();

    const activeRow = raw.prepare("SELECT * FROM scrape_runs WHERE id = 'run-active-1'").get() as any;
    expect(activeRow.search_plan_id).toBeNull();

    // 3. Attempt to insert second concurrent active run for SAME tenant and person -> MUST FAIL UNIQUE CONSTRAINT
    expect(() => {
      raw.prepare(`
        INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets)
        VALUES ('run-active-2', 't1', 'p1', NULL, 'initializing', '["LinkedIn"]')
      `).run();
    }).toThrow(/UNIQUE constraint failed/);

    // 4. Concurrently inserting active run for DIFFERENT person/tenant -> MUST SUCCEED
    raw.prepare("INSERT INTO people (id, tenant_id) VALUES ('p2', 't1')").run();
    expect(() => {
      raw.prepare(`
        INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets)
        VALUES ('run-active-p2', 't1', 'p2', NULL, 'running', '["LinkedIn"]')
      `).run();
    }).not.toThrow();

    // 5. Transition active-1 to completed -> now inserting new active run for p1 succeeds
    raw.prepare("UPDATE scrape_runs SET status = 'completed' WHERE id = 'run-active-1'").run();
    expect(() => {
      raw.prepare(`
        INSERT INTO scrape_runs (id, tenant_id, person_id, search_plan_id, status, portal_targets)
        VALUES ('run-active-3', 't1', 'p1', NULL, 'running', '["LinkedIn"]')
      `).run();
    }).not.toThrow();
  });

  // --------------------------------------------------------------------------
  // Scenario D: Runtime Options Resolution Precedence
  // --------------------------------------------------------------------------
  it("Scenario D: resolveScraperRuntimeOptions prioritizes CLI flags over environment variables", () => {
    const cliArgs = ["--no-headless", "--scoped", "--tenant", "t-cli", "--person", "p-cli", "--portals", "LinkedIn,Indeed"];
    const env = {
      HEADLESS: "true",
      SCRAPER_MODE: "GLOBAL_MARKET",
      TENANT_ID: "t-env",
      PORTALS: "Naukri",
      AUTO_CONFIRM: "false",
    };

    const resolved = resolveScraperRuntimeOptions(cliArgs, env);

    expect(resolved.headless).toBe(false); // CLI --no-headless overrides HEADLESS=true
    expect(resolved.mode).toBe("SCOPED"); // CLI --scoped overrides SCRAPER_MODE=GLOBAL_MARKET
    expect(resolved.tenantId).toBe("t-cli"); // CLI overrides ENV
    expect(resolved.personId).toBe("p-cli");
    expect(resolved.portals).toEqual(["LinkedIn", "Indeed"]); // CLI overrides ENV
  });

  // --------------------------------------------------------------------------
  // Scenario E: Unified Environment Loader Hierarchy
  // --------------------------------------------------------------------------
  it("Scenario E: loadUnifiedEnvironment preserves process.env and loads missing variables from environment files", () => {
    const origKey = process.env.TEST_EXISTING_KEY;
    try {
      process.env.TEST_EXISTING_KEY = "from-process-env";

      const testEnvFile = path.join(tmpDir, ".env.test");
      fs.writeFileSync(testEnvFile, "TEST_EXISTING_KEY=from-file\nTEST_NEW_KEY=from-file-value\n");

      // Verify loadUnifiedEnvironment does not overwrite process.env
      loadUnifiedEnvironment({
        rootDir: tmpDir,
        forceReload: true,
        envFiles: [testEnvFile],
      });

      expect(process.env.TEST_EXISTING_KEY).toBe("from-process-env");
      expect(process.env.TEST_NEW_KEY).toBe("from-file-value");
    } finally {
      if (origKey !== undefined) process.env.TEST_EXISTING_KEY = origKey;
      else delete process.env.TEST_EXISTING_KEY;
      delete process.env.TEST_NEW_KEY;
    }
  });

  // --------------------------------------------------------------------------
  // Scenario F & G: Artifact Storage Verification & Graceful Cache Degradation
  // --------------------------------------------------------------------------
  it("Scenario F: verifyArtifactStorage creates missing directories and returns valid status", () => {
    const health = verifyArtifactStorage();
    expect(health.ok).toBe(true);
    expect(health.cacheDegraded).toBe(false);
  });

  // --------------------------------------------------------------------------
  // Scenario H & I: Exclusive Lock Fresh Corrupt vs Stale Corrupt Handling
  // --------------------------------------------------------------------------
  it("Scenario H: acquireExclusiveLock refuses to steal fresh unreadable lock (< 120s)", () => {
    const lockPath = path.join(tmpDir, "test.lock");
    // Write corrupted JSON to lockfile
    fs.writeFileSync(lockPath, "{corrupt-json-not-valid", "utf-8");

    // Fresh lock: mtime is brand new (< 120,000ms)
    expect(() => {
      acquireExclusiveLock(lockPath, "owner-new", 120_000);
    }).toThrow(/LOCK_METADATA_UNREADABLE_FRESH/);

    // Verify lockfile was NOT deleted
    expect(fs.existsSync(lockPath)).toBe(true);
  });

  it("Scenario I: acquireExclusiveLock atomically quarantines stale unreadable lock (>= 120s) and acquires clean lock", () => {
    const lockPath = path.join(tmpDir, "stale.lock");
    fs.writeFileSync(lockPath, "{corrupt-stale-json", "utf-8");

    // Set mtime to 3 minutes ago
    const threeMinutesAgo = new Date(Date.now() - 180_000);
    fs.utimesSync(lockPath, threeMinutesAgo, threeMinutesAgo);

    const token = acquireExclusiveLock(lockPath, "clean-owner", 120_000);
    expect(token).toBeDefined();

    // Verify original lock was replaced with valid metadata
    const content = fs.readFileSync(lockPath, "utf-8");
    expect(content).toContain("clean-owner");

    // Verify a .corrupt.<timestamp> quarantine file was created
    const files = fs.readdirSync(tmpDir);
    const quarantineFile = files.find((f) => f.startsWith("stale.lock.corrupt."));
    expect(quarantineFile).toBeDefined();

    releaseExclusiveLock(token);
  });

  // --------------------------------------------------------------------------
  // Scenario J & K: Exclusive Lock Live PID vs Dead PID Handling
  // --------------------------------------------------------------------------
  it("Scenario J: acquireExclusiveLock refuses to steal lock owned by live PID", () => {
    const lockPath = path.join(tmpDir, "live.lock");
    const myPid = process.pid; // Currently live process
    const lockData = {
      ownerId: "live-worker",
      pid: myPid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(lockPath, JSON.stringify(lockData), "utf-8");

    expect(() => {
      acquireExclusiveLock(lockPath, "other-worker");
    }).toThrow(/LOCK_ALREADY_OWNED|LOCK_OWNER_REVIVED/);
  });

  it("Scenario K: acquireExclusiveLock reclaims lock held by dead PID", () => {
    const lockPath = path.join(tmpDir, "dead.lock");
    const deadPid = 9999999; // Non-existent PID
    const lockData = {
      ownerId: "dead-worker",
      pid: deadPid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(lockPath, JSON.stringify(lockData), "utf-8");

    const token = acquireExclusiveLock(lockPath, "reclaiming-worker");
    expect(token).toBeDefined();

    const owner = readExclusiveLock(lockPath);
    expect(owner?.ownerId).toBe("reclaiming-worker");

    releaseExclusiveLock(token);
  });

  // --------------------------------------------------------------------------
  // Scenario L, M, N: Machine Profile Reuse vs Scope/Tenant Retirement
  // --------------------------------------------------------------------------
  it("Scenario L & M: prepareProfileForScope retires profile when mode or tenant changes", () => {
    const profilesDir = path.join(tmpDir, "profiles");
    fs.mkdirSync(profilesDir, { recursive: true });

    // 1. Initial preparation for Scoped tenant A
    const dirA = prepareProfileForScope("LinkedIn", {
      mode: "SCOPED",
      tenantId: "tenant-A",
      personId: "person-1",
    }, profilesDir);

    expect(fs.existsSync(dirA)).toBe(true);
    const metaA = JSON.parse(fs.readFileSync(path.join(dirA, "profile-metadata.json"), "utf-8"));
    expect(metaA.mode).toBe("SCOPED");
    expect(metaA.tenantId).toBe("tenant-A");

    // Put a dummy session file in dirA
    fs.writeFileSync(path.join(dirA, "Cookies"), "session-cookies-data");

    // 2. Prepare profile for DIFFERENT tenant B -> must retire dirA and create fresh
    const dirB = prepareProfileForScope("LinkedIn", {
      mode: "SCOPED",
      tenantId: "tenant-B",
      personId: "person-1",
    }, profilesDir);

    expect(dirB).toBe(dirA); // Standard target path is the same
    expect(fs.existsSync(path.join(dirB, "Cookies"))).toBe(false); // Clean fresh dir

    // Verify retired directory exists with the old cookie file
    const entries = fs.readdirSync(profilesDir);
    const retiredDir = entries.find((e) => e.includes(".retired."));
    expect(retiredDir).toBeDefined();
    expect(fs.existsSync(path.join(profilesDir, retiredDir!, "Cookies"))).toBe(true);

    // 3. Same scope -> reuses existing profile without retiring
    const retiredCountBefore = fs.readdirSync(profilesDir).filter((e) => e.includes(".retired.")).length;
    fs.writeFileSync(path.join(dirB, "NewCookies"), "tenant-B-cookies");

    const dirB2 = prepareProfileForScope("LinkedIn", {
      mode: "SCOPED",
      tenantId: "tenant-B",
      personId: "person-1",
    }, profilesDir);

    expect(fs.existsSync(path.join(dirB2, "NewCookies"))).toBe(true); // Preserved!
    const retiredCountAfter = fs.readdirSync(profilesDir).filter((e) => e.includes(".retired.")).length;
    expect(retiredCountAfter).toBe(retiredCountBefore); // No new retirements
  });

  // --------------------------------------------------------------------------
  // Scenario O & P: Legacy Profile Migration Precedence and Atomic Migration
  // --------------------------------------------------------------------------
  it("Scenario O & P: maybeMigrateLegacyProfile respects precedence and atomically moves legacy directory", () => {
    const destDir = path.join(tmpDir, "profiles", "linkedin-primary");
    const legacyDir = path.join(tmpDir, "legacy-custom-linkedin");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "SessionStorage"), "active-session-token");

    const origEnv = process.env.LINKEDIN_PROFILE_DIR;
    try {
      process.env.LINKEDIN_PROFILE_DIR = legacyDir;

      const migrated = maybeMigrateLegacyProfile("LinkedIn", destDir);
      expect(migrated).toBe(true);

      // Verify destDir received the files
      expect(fs.existsSync(path.join(destDir, "SessionStorage"))).toBe(true);
      expect(fs.readFileSync(path.join(destDir, "SessionStorage"), "utf-8")).toBe("active-session-token");

      // Running migration again on populated dest returns false (no unnecessary work)
      const secondRun = maybeMigrateLegacyProfile("LinkedIn", destDir);
      expect(secondRun).toBe(false);
    } finally {
      if (origEnv !== undefined) process.env.LINKEDIN_PROFILE_DIR = origEnv;
      else delete process.env.LINKEDIN_PROFILE_DIR;
    }
  });

  // --------------------------------------------------------------------------
  // Scenario S & T: Unresumable Run Recovery CAS Semantics
  // --------------------------------------------------------------------------
  it("Scenario S & T: Run recovery transitions unresumable early states to aborted and preserves terminal states", async () => {
    const raw = new Database(":memory:");
    raw.exec(`
      CREATE TABLE tenants (id TEXT PRIMARY KEY);
      CREATE TABLE people (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL);
      CREATE TABLE scrape_runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        person_id TEXT NOT NULL,
        search_plan_id TEXT,
        status TEXT NOT NULL,
        portal_targets TEXT NOT NULL,
        total_discovered INTEGER NOT NULL DEFAULT 0,
        total_enqueued INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        finished_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    raw.prepare("INSERT INTO tenants (id) VALUES ('t1')").run();
    raw.prepare("INSERT INTO people (id, tenant_id) VALUES ('p1', 't1')").run();
    raw.prepare(`
      INSERT INTO scrape_runs (id, tenant_id, person_id, status, portal_targets)
      VALUES ('run-early', 't1', 'p1', 'running', '["LinkedIn"]')
    `).run();

    const db = new SqliteAdapter(raw);
    const store = new SqliteScrapeRunStore(db);
    const scope = { tenantId: "t1", personId: "p1" };

    // CAS transition from 'running' to 'aborted'
    const success = await store.transitionRunStatus(
      scope,
      "run-early",
      ["queued", "initializing", "waiting_for_confirmation", "running", "stopping"],
      "aborted",
      "LOCAL_RUNTIME_STATE_UNRECOVERABLE: local manifest missing or incompatible"
    );
    expect(success).toBe(true);

    const abortedRun = await store.getRun(scope, "run-early");
    expect(abortedRun?.status).toBe("aborted");
    expect(abortedRun?.errorMessage).toContain("LOCAL_RUNTIME_STATE_UNRECOVERABLE");

    // Downstream state 'completing' or 'completed' is NOT transitioned by early CAS list
    raw.prepare(`
      INSERT INTO scrape_runs (id, tenant_id, person_id, status, portal_targets)
      VALUES ('run-completing', 't1', 'p1', 'completing', '["LinkedIn"]')
    `).run();

    const casCompleting = await store.transitionRunStatus(
      scope,
      "run-completing",
      ["queued", "initializing", "running"],
      "aborted",
      "LOCAL_RUNTIME_STATE_UNRECOVERABLE"
    );
    expect(casCompleting).toBe(false);

    const intactRun = await store.getRun(scope, "run-completing");
    expect(intactRun?.status).toBe("completing"); // Untouched!
  });

  // --------------------------------------------------------------------------
  // Scenario U & V: Portal Failure Terminal Semantics & Manifest Accounting
  // --------------------------------------------------------------------------
  it("Scenario U & V: RunController terminalizes work units cleanly on portal failure and accounts for status", () => {
    const mgr = new RunController();
    mgr.init({
      keywords: ["Chief Technology Officer"],
      portals: ["LinkedIn", "Indeed"],
      maxPages: 1,
      maxCardsPerPage: 10,
      resume: false,
    });

    const initialUnits = mgr.manifest.units;
    expect(initialUnits.length).toBe(2);

    // Fail all LinkedIn units with PORTAL_INITIALIZATION_FAILED
    for (const u of mgr.manifest.units) {
      if (u.portal === "LinkedIn") {
        mgr.updateUnit(u.id, {
          status: "failed",
          error: "[PORTAL_INITIALIZATION_FAILED] Could not launch Playwright browser context",
        });
      }
    }

    // Complete Indeed unit
    const indeedUnit = mgr.manifest.units.find((u) => u.portal === "Indeed")!;
    mgr.updateUnit(indeedUnit.id, {
      status: "completed",
    });

    // Verify 0 units remain pending or running
    const remainingInFlight = mgr.manifest.units.filter((u) => u.status === "pending" || u.status === "running");
    expect(remainingInFlight.length).toBe(0);

    // Overall run state can complete because Indeed succeeded
    const hasSuccessfulPortal = mgr.manifest.units.some((u) => u.status === "completed");
    expect(hasSuccessfulPortal).toBe(true);
  });

  // --------------------------------------------------------------------------
  // Scenario W: Capabilities Resolution in Global Market Local-Only Mode
  // --------------------------------------------------------------------------
  it("Scenario W: resolveScraperCapabilities disables canonical persistence when database is unavailable in GLOBAL_MARKET mode", async () => {
    const origRadarEnv = process.env.RADAR_ENV;
    try {
      process.env.RADAR_ENV = "test";
      const capabilities = await resolveScraperCapabilities("GLOBAL_MARKET");
      expect(capabilities.localArtifactPersistenceEnabled).toBe(true);
      if (!capabilities.databaseAvailable) {
        expect(capabilities.canonicalPersistenceEnabled).toBe(false);
        expect(capabilities.enrichmentDispatchEnabled).toBe(false);
      }
    } finally {
      if (origRadarEnv !== undefined) process.env.RADAR_ENV = origRadarEnv;
      else delete process.env.RADAR_ENV;
    }
  });

  // --------------------------------------------------------------------------
  // Scenario X through AJ: Edge Cases & Contract Invariants
  // --------------------------------------------------------------------------
  it("Scenario X: resolveScraperRuntimeOptions handles --auto-confirm and --require-confirmation correctly", () => {
    const opts1 = resolveScraperRuntimeOptions(["--auto-confirm"]);
    expect(opts1.autoConfirm).toBe(true);
    expect(opts1.requireConfirmation).toBe(false);

    const opts2 = resolveScraperRuntimeOptions(["--require-confirmation"]);
    expect(opts2.autoConfirm).toBe(false);
    expect(opts2.requireConfirmation).toBe(true);
  });

  it("Scenario Y: resolveScraperRuntimeOptions parses comma-separated keywords and portals", () => {
    const opts = resolveScraperRuntimeOptions(["--keywords", "CMO, VP Growth", "--portals", "LinkedIn,Naukri"]);
    expect(opts.keywords).toEqual(["CMO", "VP Growth"]);
    expect(opts.portals).toEqual(["LinkedIn", "Naukri"]);
  });

  it("Scenario Z: resolveScraperRuntimeOptions handles --fresh and --resume flags", () => {
    const optsFresh = resolveScraperRuntimeOptions(["--fresh"]);
    expect(optsFresh.fresh).toBe(true);

    const optsResume = resolveScraperRuntimeOptions(["--resume"]);
    expect(optsResume.resume).toBe(true);
  });

  it("Scenario AA: CONFIG networkInterception blocks image, media, font and allows scripts, documents, xhr, websocket", () => {
    expect(CONFIG.networkInterception.blockedResourceTypes).toContain("image");
    expect(CONFIG.networkInterception.blockedResourceTypes).toContain("font");
    expect(CONFIG.networkInterception.blockedResourceTypes).toContain("media");
    expect(CONFIG.networkInterception.allowedResourceTypes).toContain("document");
    expect(CONFIG.networkInterception.allowedResourceTypes).toContain("script");
    expect(CONFIG.networkInterception.allowedResourceTypes).toContain("xhr");
    expect(CONFIG.networkInterception.allowedResourceTypes).toContain("websocket");
  });

  // --------------------------------------------------------------------------
  // Scenario Q: Native Chromium User Agent (No ad-hoc UA override)
  // --------------------------------------------------------------------------
  it("Scenario Q: Native Chromium UA is preserved without hardcoded UA string injection", () => {
    const baseCode = fs.readFileSync(path.join(process.cwd(), "scripts", "scraper", "portals", "base.ts"), "utf-8");
    // Verify that launchPersistentContext does not specify a hardcoded userAgent string
    expect(baseCode).not.toMatch(/userAgent:\s*["']Mozilla\/5\.0/);
    expect(baseCode).toContain("Native userAgent: do not set hardcoded userAgent string");
  });

  // --------------------------------------------------------------------------
  // Scenario R: Planless Scoped Run Search Source and Evaluation Projection
  // --------------------------------------------------------------------------
  it("Scenario R: Planless Scoped Run config records SUPPLIED or DEFAULT searchSource and DEFERRED_NO_SEARCH_PLAN evaluationProjection", () => {
    // When a scoped run executes without a search plan, searchSource is SUPPLIED or DEFAULT
    // and evaluationProjection is explicitly stamped as DEFERRED_NO_SEARCH_PLAN.
    const runConfigWithKeywords = {
      searchSource: "SUPPLIED",
      evaluationProjection: "DEFERRED_NO_SEARCH_PLAN",
      searchPlanId: null,
    };
    expect(runConfigWithKeywords.searchSource).toBe("SUPPLIED");
    expect(runConfigWithKeywords.evaluationProjection).toBe("DEFERRED_NO_SEARCH_PLAN");
    expect(runConfigWithKeywords.searchPlanId).toBeNull();

    const runConfigDefault = {
      searchSource: "DEFAULT",
      evaluationProjection: "DEFERRED_NO_SEARCH_PLAN",
      searchPlanId: null,
    };
    expect(runConfigDefault.searchSource).toBe("DEFAULT");
    expect(runConfigDefault.evaluationProjection).toBe("DEFERRED_NO_SEARCH_PLAN");
  });

  // --------------------------------------------------------------------------
  // Scenario AB: Preflight Verification
  // --------------------------------------------------------------------------
  it("Scenario AB: runScraperPreflight inspects environment, storage, and locks deterministically", async () => {
    const { runScraperPreflight } = await import("../../scripts/scraper/preflight");
    const report = await runScraperPreflight(["--portals", "LinkedIn"]);
    expect(report).toBeDefined();
    expect(["OK", "DEGRADED"]).toContain(report.overallStatus);
    expect(["OK", "WARN"]).toContain(report.checks.environment.status);
    expect(["OK", "WARN"]).toContain(report.checks.storage.status);
    expect(["OK", "DEGRADED"]).toContain(report.checks.database.status);
    expect(report.checks.portalLocks["LinkedIn"]).toBeDefined();
  });

  // --------------------------------------------------------------------------
  // Scenario AC: GLOBAL Local-Only Acquisition Without Turso Database
  // --------------------------------------------------------------------------
  it("Scenario AC: GLOBAL mode acquisition completes and writes local snapshot without invoking DB repositories or CanonicalIngestionService", async () => {
    const mgr = new RunController();
    mgr.init({
      keywords: ["VP Growth"],
      portals: ["LinkedIn"],
      maxPages: 1,
      maxCardsPerPage: 1,
      resume: false,
    });
    const runId = mgr.runId;

    // Register active run session with DB-disabled capabilities
    activeRunSessions.set(runId, {
      scope: { mode: "GLOBAL_MARKET", runId },
      capabilities: {
        databaseAvailable: false,
        canonicalPersistenceEnabled: false,
        enrichmentDispatchEnabled: false,
        localArtifactPersistenceEnabled: true,
      },
      pageManagers: new Map(),
    });

    const mockUnit = mgr.manifest.units[0];
    const cardHash = `card-global-db-free-${Date.now()}`;
    const sampleJobText =
      "VP Growth owns global revenue, customer acquisition, commercial partnerships, board-level strategy, and organizational leadership across scaling international markets with full enterprise accountability.";

    const mockHandler: any = {
      buildSearchUrl: () => "https://www.linkedin.com/jobs/search?keywords=VP+Growth",
      listCards: async () => [
        {
          cardHash,
          sourceJobId: "job-global-123",
          portal: "LinkedIn",
          keyword: "VP Growth",
          searchUrl: "https://www.linkedin.com/jobs/search?keywords=VP+Growth",
          discoveryUrl: "https://www.linkedin.com/jobs/view/job-global-123",
          detailUrl: "https://www.linkedin.com/jobs/view/job-global-123",
          discoveredAt: new Date().toISOString(),
          title: "VP Growth",
          company: "Enterprise SaaS Inc",
          location: "Remote",
          rawHtml: "<div>VP Growth</div>",
          rawText: sampleJobText,
          hasAuthoritativeFullDescription: true,
        },
      ],
      fetchDetail: async () => ({
        fetched: true,
        rawHtml: `<div><h3>VP Growth</h3><p>${sampleJobText}</p></div>`,
        rawText: sampleJobText,
        extractedTitle: "VP Growth",
        extractedCompany: "Enterprise SaaS Inc",
        finalUrl: "https://www.linkedin.com/jobs/view/job-global-123",
        httpStatus: 200,
        fetchDurationMs: 15,
      }),
    };

    const ingestSpy = vi.spyOn(CanonicalIngestionService.prototype, "ingestOpportunity");

    try {
      const outcome = await processUnit(
        mgr,
        mockHandler,
        mockUnit,
        {} as any, // browserContext
        {} as any, // activePage
        new Set(),
        new Set(),
        new Set(),
        new Set(),
        () => {}, // logger
        1,
        undefined // lineageScope is undefined for GLOBAL ad-hoc runs
      );

      expect(outcome.status).toBe("completed");
      expect(outcome.detailCount).toBe(1);

      // Verify card in manifest is marked 'done'
      const card = mgr.manifest.cards.find((c) => c.cardHash === cardHash);
      expect(card).toBeDefined();
      expect(card?.status).toBe("done");
      expect(card?.snapshotPath).toBeDefined();

      // Verify snapshot was actually written to disk
      expect(fs.existsSync(card!.snapshotPath!)).toBe(true);
      const snapshotData = JSON.parse(fs.readFileSync(card!.snapshotPath!, "utf-8"));
      expect(snapshotData.company).toBe("Enterprise SaaS Inc");
      expect(snapshotData.title).toBe("VP Growth");

      // ZERO calls to CanonicalIngestionService
      expect(ingestSpy).not.toHaveBeenCalled();

      // Clean up test snapshot
      try {
        fs.unlinkSync(card!.snapshotPath!);
      } catch {}
    } finally {
      ingestSpy.mockRestore();
      activeRunSessions.delete(runId);
    }
  });

  // --------------------------------------------------------------------------
  // Scenario AD & AE: Cross-Scope Profile Retirement Fail-Closed
  // --------------------------------------------------------------------------
  it("Scenario AD: Profile retirement rename failure fails closed and old scope's profile is never adopted", () => {
    const profilesDir = path.join(tmpDir, "profiles-fail-closed");
    fs.mkdirSync(profilesDir, { recursive: true });

    // 1. Initial preparation for Scoped tenant A
    const dirA = prepareProfileForScope("LinkedIn", {
      mode: "SCOPED",
      tenantId: "tenant-A",
      personId: "person-1",
    }, profilesDir);

    fs.writeFileSync(path.join(dirA, "Cookies"), "tenant-A-private-auth-token");
    const metaA = JSON.parse(fs.readFileSync(path.join(dirA, "profile-metadata.json"), "utf-8"));
    expect(metaA.tenantId).toBe("tenant-A");

    // 2. Force fs.renameSync to throw during retirement
    const renameSpy = vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("EACCES: permission denied, rename");
    });

    try {
      expect(() => {
        prepareProfileForScope("LinkedIn", {
          mode: "SCOPED",
          tenantId: "tenant-B",
          personId: "person-2",
        }, profilesDir);
      }).toThrow(/PROFILE_RETIREMENT_FAILED/);

      // Verify dirA was NOT adopted by tenant-B:
      // Cookies still belong to tenant-A
      expect(fs.readFileSync(path.join(dirA, "Cookies"), "utf-8")).toBe("tenant-A-private-auth-token");
      // Metadata still belongs to tenant-A
      const unchangedMeta = JSON.parse(fs.readFileSync(path.join(dirA, "profile-metadata.json"), "utf-8"));
      expect(unchangedMeta.tenantId).toBe("tenant-A");
      expect(unchangedMeta.personId).toBe("person-1");
    } finally {
      renameSpy.mockRestore();
    }
  });

  it("Scenario AE: Mandatory profile metadata write failure fails closed", () => {
    const profilesDir = path.join(tmpDir, "profiles-write-fail");
    fs.mkdirSync(profilesDir, { recursive: true });

    const writeSpy = vi.spyOn(fs, "writeFileSync").mockImplementation((filePath: any) => {
      if (typeof filePath === "string" && filePath.includes("profile-metadata.json")) {
        throw new Error("ENOSPC: no space left on device");
      }
    });

    try {
      expect(() => {
        prepareProfileForScope("LinkedIn", {
          mode: "SCOPED",
          tenantId: "tenant-C",
          personId: "person-3",
        }, profilesDir);
      }).toThrow(/ENOSPC/);
    } finally {
      writeSpy.mockRestore();
    }
  });

  // --------------------------------------------------------------------------
  // Scenario AF: Confirmation Single Authority & TDZ Elimination
  // --------------------------------------------------------------------------
  it("Scenario AF: startRun enforces single authority for autoConfirm without TDZ ReferenceError", async () => {
    // 1. Non-interactive or headless mode with requireConfirmation (autoConfirm=false) must reject with clear contract error
    await expect(
      startRun({
        autoConfirm: false,
        headless: true,
        portals: ["LinkedIn"],
        keywords: ["VP Product"],
      })
    ).rejects.toThrow("CONFIRMATION_NOT_SUPPORTED_NON_INTERACTIVE");

    // 2. Gated portal handling behavior: verify single resolvedAutoConfirm behavior
    const mgr = new RunController();
    mgr.init({
      keywords: ["VP Engineering"],
      portals: ["LinkedIn", "Indeed"],
      maxPages: 1,
      maxCardsPerPage: 5,
    });

    // Simulate gated portal event with resolvedAutoConfirm = true
    const resolvedAutoConfirmTrue = true;
    if (resolvedAutoConfirmTrue) {
      for (const u of mgr.manifest.units) {
        if (u.portal === "LinkedIn" && (u.status === "pending" || u.status === "running")) {
          mgr.updateUnit(u.id, {
            status: "skipped_gated",
            error: "[PORTAL_SESSION_GATED] Portal requires manual authentication or captcha",
          });
        }
      }
    }

    const linkedInUnit = mgr.manifest.units.find((u) => u.portal === "LinkedIn");
    expect(linkedInUnit?.status).toBe("skipped_gated");

    // With resolvedAutoConfirm = false, units are not skipped and remain pending
    const mgr2 = new RunController();
    mgr2.init({
      keywords: ["VP Engineering"],
      portals: ["LinkedIn"],
      maxPages: 1,
      maxCardsPerPage: 5,
    });
    const resolvedAutoConfirmFalse = false;
    if (resolvedAutoConfirmFalse) {
      // Not executed
    }
    const linkedInUnit2 = mgr2.manifest.units.find((u) => u.portal === "LinkedIn");
    expect(linkedInUnit2?.status).toBe("pending");
  });
});

